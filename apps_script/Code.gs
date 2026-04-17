/**
 * PANW Prospect Scraper — runs inside a Google Sheet.
 *
 * Adds a "Prospect Scraper" menu. Reads config + API keys from the Config
 * sheet, queries Apollo for Ontario mid-market prospects running competitor
 * security tech, asks Claude Opus 4.7 for a per-account strategy plan, and
 * writes one Google Doc per prospect into the user's Drive (or a specific
 * folder). Logs results to the Results sheet.
 */

// -------------------- Constants --------------------

const MODEL = 'claude-opus-4-7';

const COMPETITOR_TECH_UIDS = [
  'fortinet', 'check-point', 'cisco', 'zscaler', 'crowdstrike',
  'sentinelone', 'netskope', 'cloudflare', 'arctic-wolf', 'sophos',
];

const PANW_TECH_UIDS = [
  'palo-alto-networks', 'prisma-cloud', 'cortex-xdr', 'cortex-xsiam',
];

const TARGET_TITLES = [
  'CIO', 'Chief Information Officer',
  'CISO', 'Chief Information Security Officer',
  'VP of Security', 'Vice President of Security',
  'Director of Security', 'Director of Information Security',
  'Director of IT', 'Director of Information Technology',
  'IT Manager',
];

const SYSTEM_PROMPT = `You are a senior Palo Alto Networks account strategist. \
You build outbound prospect plans for a Territory Account Manager selling into \
mid-market companies (1,500 employees or fewer) in Ontario, Canada.

# Palo Alto Networks product portfolio

**Network Security**
- NGFW (PA-Series, VM-Series, CN-Series) replaces Fortinet, Check Point, Cisco ASA/Firepower, SonicWall.
- Prisma Access / Prisma SASE replaces Zscaler, Netskope, Cloudflare One, Cisco Umbrella.
- Prisma SD-WAN (CloudGenix).

**Cloud Security**
- Prisma Cloud (CNAPP) replaces Wiz, Orca, Lacework, Aqua.

**Security Operations**
- Cortex XDR replaces CrowdStrike, SentinelOne, Defender for Endpoint, Sophos Intercept X.
- Cortex XSIAM (next-gen SIEM + SOAR + XDR) replaces Splunk + Arctic Wolf + legacy MSSP stacks.
- Cortex XSOAR (SOAR automation).
- Unit 42 IR retainer and threat intel.

# Competitor displacement angles

- Fortinet: NGFW refresh fatigue, appliance sprawl, weak cloud posture. Lead with Prisma SASE or PA-Series + WildFire/ATP.
- Check Point: aging UI, licensing complexity. Lead with NGFW + Panorama.
- Cisco: multi-vendor Cisco stack fatigue. Lead with consolidation (NGFW + SASE + XDR).
- Zscaler/Netskope/Cloudflare: SSE-only vendors. Lead with Prisma SASE (full SASE + SD-WAN + ZTNA).
- CrowdStrike/SentinelOne: EDR-only, weak SIEM/SOAR. Lead with Cortex XSIAM.
- Sophos: mid-market incumbent, weaker threat intel. Lead with Cortex XDR + Unit 42 and NGFW refresh.
- Arctic Wolf: MDR-as-a-service with per-seat pricing that balloons. Lead with XSIAM + Unit 42 MDR — own the platform instead of renting an MSSP.

# Persona messaging

- CIO: business outcomes — cost consolidation, vendor reduction, staff productivity, board reporting. "One platform, fewer tools."
- CISO: risk outcomes — ransomware readiness, cloud posture, SOC efficacy, IR time-to-contain. Reference Unit 42.
- VP/Director of Security: operational — alert volume, tool sprawl, MTTD/MTTR. XSIAM consolidation story.
- Director of IT: infrastructure — firewall refresh, SASE migration, remote access modernization.
- IT Manager: tactical — day-to-day ops, deployment effort, support quality.

# Email guidance

Every draft email must:
1. Be 90–130 words.
2. Reference the specific competitor signal detected in their stack.
3. Open with a relevant business or security trigger, not pleasantries.
4. Have a concrete CTA: 15-minute intro, Unit 42 threat briefing, or a specific customer-story reference.
5. Subject line under 7 words, no clickbait, no ALL CAPS.
6. Plain sign-off.

Canadian spelling. Do not invent customer names, statistics, or case studies.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    account_summary: { type: 'string' },
    competitive_landscape: { type: 'string' },
    pain_hypotheses: { type: 'array', items: { type: 'string' } },
    panw_product_fit: { type: 'array', items: { type: 'string' } },
    recommended_entry_point: { type: 'string' },
    strategic_rationale: { type: 'string' },
    next_steps: { type: 'array', items: { type: 'string' } },
    draft_emails: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          to_persona: { type: 'string' },
          to_name: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['to_persona', 'to_name', 'subject', 'body', 'rationale'],
      },
    },
  },
  required: [
    'account_summary', 'competitive_landscape', 'pain_hypotheses',
    'panw_product_fit', 'recommended_entry_point', 'strategic_rationale',
    'next_steps', 'draft_emails',
  ],
};

// -------------------- Menu --------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Prospect Scraper')
    .addItem('Run', 'runProspectPipeline')
    .addSeparator()
    .addItem('Initialize sheets', 'initializeSheets')
    .addToUi();
}

function initializeSheets() {
  const ss = SpreadsheetApp.getActive();

  let config = ss.getSheetByName('Config');
  if (!config) config = ss.insertSheet('Config');
  config.clear();
  const rows = [
    ['Apollo API Key', ''],
    ['Anthropic API Key', ''],
    ['Location', 'Ontario, Canada'],
    ['Max Employees', 1500],
    ['Max Prospects Per Run', 3],
    ['Output Folder ID (optional)', ''],
  ];
  config.getRange(1, 1, rows.length, 2).setValues(rows);
  config.getRange(1, 1, rows.length, 1).setFontWeight('bold');
  config.setColumnWidth(1, 220);
  config.setColumnWidth(2, 420);

  let results = ss.getSheetByName('Results');
  if (!results) results = ss.insertSheet('Results');
  if (results.getLastRow() === 0) {
    const header = ['Timestamp', 'Company', 'Industry', 'Employees',
                    'Competitors', 'Contacts Found', 'Doc URL', 'Status'];
    results.getRange(1, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#f0f0f0');
    results.setFrozenRows(1);
  }

  SpreadsheetApp.getUi().alert(
    'Sheets ready. Fill in your API keys on the Config sheet, then run ' +
    'Prospect Scraper → Run.');
}

// -------------------- Main --------------------

function runProspectPipeline() {
  const cfg = readConfig();
  if (!cfg.apolloKey || !cfg.anthropicKey) {
    SpreadsheetApp.getUi().alert(
      'Missing API keys. Fill both keys on the Config sheet and try again.');
    return;
  }

  const startTime = Date.now();
  const RUNTIME_BUDGET_MS = 5 * 60 * 1000; // leave buffer before 6-min hard cap

  let orgs;
  try {
    orgs = apolloSearchCompanies(cfg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Apollo company search failed: ' + e.message);
    return;
  }

  const prospects = [];
  for (const org of orgs) {
    if (isLikelyPanwCustomer(org)) continue;
    const competitors = detectCompetitors(org);
    if (competitors.length === 0) continue;
    prospects.push({ org, competitors });
    if (prospects.length >= cfg.maxProspects) break;
  }

  if (prospects.length === 0) {
    SpreadsheetApp.getUi().alert(
      'No prospects matched. Try widening the filters on the Config sheet.');
    return;
  }

  for (const { org, competitors } of prospects) {
    if (Date.now() - startTime > RUNTIME_BUDGET_MS) {
      logResult(org, competitors, 0, '', 'Skipped — approaching 6-min runtime cap. Run again to continue.');
      continue;
    }

    let contacts = [];
    try {
      contacts = apolloSearchPeople(cfg.apolloKey, org.id);
    } catch (e) {
      logResult(org, competitors, 0, '', 'People search failed: ' + e.message);
      continue;
    }

    let strategy;
    try {
      strategy = generateStrategy(cfg.anthropicKey, org, contacts, competitors);
    } catch (e) {
      logResult(org, competitors, contacts.length, '',
                'Claude generation failed: ' + e.message);
      continue;
    }

    let docUrl;
    try {
      docUrl = createAccountDoc(org, contacts, competitors, strategy, cfg.folderId);
    } catch (e) {
      logResult(org, competitors, contacts.length, '',
                'Doc creation failed: ' + e.message);
      continue;
    }

    logResult(org, competitors, contacts.length, docUrl, 'OK');
  }

  SpreadsheetApp.getUi().alert('Done. Check the Results sheet for links.');
}

// -------------------- Config + logging --------------------

function readConfig() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sheet) throw new Error('Config sheet missing. Run Initialize sheets first.');
  const values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
  const map = {};
  values.forEach(([k, v]) => { map[String(k).trim()] = v; });
  return {
    apolloKey: String(map['Apollo API Key'] || '').trim(),
    anthropicKey: String(map['Anthropic API Key'] || '').trim(),
    location: String(map['Location'] || 'Ontario, Canada').trim(),
    maxEmployees: Number(map['Max Employees'] || 1500),
    maxProspects: Number(map['Max Prospects Per Run'] || 3),
    folderId: String(map['Output Folder ID (optional)'] || '').trim(),
  };
}

function logResult(org, competitors, contactCount, docUrl, status) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Results');
  sheet.appendRow([
    new Date(),
    org.name || '',
    org.industry || '',
    org.estimated_num_employees || '',
    competitors.join(', '),
    contactCount,
    docUrl,
    status,
  ]);
}

// -------------------- Apollo --------------------

function apolloSearchCompanies(cfg) {
  const payload = {
    organization_locations: [cfg.location],
    organization_num_employees_ranges: ['1,' + cfg.maxEmployees],
    currently_using_any_of_technology_uids: COMPETITOR_TECH_UIDS,
    page: 1,
    per_page: 25,
  };
  const resp = apolloFetch('/mixed_companies/search', payload, cfg.apolloKey);
  return resp.organizations || resp.accounts || [];
}

function apolloSearchPeople(apiKey, orgId) {
  if (!orgId) return [];
  const payload = {
    organization_ids: [orgId],
    person_titles: TARGET_TITLES,
    page: 1,
    per_page: 10,
  };
  const resp = apolloFetch('/mixed_people/search', payload, apiKey);
  return resp.people || resp.contacts || [];
}

function apolloFetch(path, payload, apiKey) {
  const url = 'https://api.apollo.io/api/v1' + path;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-cache', 'X-Api-Key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code === 429) {
    Utilities.sleep(30000);
    return apolloFetch(path, payload, apiKey);
  }
  if (code >= 300) {
    throw new Error('Apollo ' + code + ': ' + body.substring(0, 200));
  }
  return JSON.parse(body);
}

function detectCompetitors(org) {
  const techs = (org.technologies || []).flatMap(t =>
    [String(t.uid || '').toLowerCase(), String(t.name || '').toLowerCase()]);
  return COMPETITOR_TECH_UIDS.filter(
    uid => techs.some(t => t.indexOf(uid) >= 0));
}

function isLikelyPanwCustomer(org) {
  const techs = (org.technologies || []).flatMap(t =>
    [String(t.uid || '').toLowerCase(), String(t.name || '').toLowerCase()]);
  return PANW_TECH_UIDS.some(uid => techs.some(t => t.indexOf(uid) >= 0));
}

// -------------------- Claude --------------------

function generateStrategy(apiKey, org, contacts, competitors) {
  const techNames = (org.technologies || [])
    .map(t => t.name).filter(Boolean).join(', ');
  const contactLines = (contacts.length > 0
    ? contacts.map(c =>
        '- ' + [c.first_name, c.last_name].filter(Boolean).join(' ') +
        ' — ' + (c.title || '') +
        ' (email: ' + (c.email || 'not available') +
        ', linkedin: ' + (c.linkedin_url || 'n/a') + ')')
      .join('\n')
    : 'No contacts identified yet.');

  const userPrompt =
    'Build an account strategy plan for the following prospect.\n\n' +
    '# Company\n' +
    '- Name: ' + (org.name || '') + '\n' +
    '- Website: ' + (org.website_url || org.primary_domain || 'unknown') + '\n' +
    '- Industry: ' + (org.industry || 'unknown') + '\n' +
    '- Employees: ' + (org.estimated_num_employees || 'unknown') + '\n' +
    '- Location: ' + [org.city, org.state, org.country].filter(Boolean).join(', ') + '\n' +
    '- Description: ' + (org.short_description || org.description || 'n/a') + '\n\n' +
    '# Tech stack signals\n' +
    '- Full detected stack: ' + (techNames || 'unknown') + '\n' +
    '- Competitor security tools detected: ' +
      (competitors.length > 0 ? competitors.join(', ') : 'none detected; infer from stack') + '\n\n' +
    '# Target personas and contacts identified\n' + contactLines + '\n\n' +
    'Produce a complete account strategy plan and a tailored outreach email for ' +
    'each named contact. If a contact was not found for a persona, still produce ' +
    'a persona-level email with to_name left as an empty string.';

  const body = {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code >= 300) {
    throw new Error('Claude ' + code + ': ' + text.substring(0, 300));
  }
  const parsed = JSON.parse(text);
  const textBlock = (parsed.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text block');
  return JSON.parse(textBlock.text);
}

// -------------------- Docs --------------------

function createAccountDoc(org, contacts, competitors, strategy, folderId) {
  const title = 'Account Strategy Plan — ' + (org.name || 'Prospect');
  const doc = DocumentApp.create(title);
  const body = doc.getBody();
  body.clear();

  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('Palo Alto Networks | Prospect Outreach Plan')
      .setItalic(true);

  body.appendParagraph('1. Company Overview')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const facts = [
    ['Website', org.website_url || org.primary_domain || '—'],
    ['Industry', org.industry || '—'],
    ['Employees', String(org.estimated_num_employees || '—')],
    ['Location', [org.city, org.state, org.country].filter(Boolean).join(', ') || '—'],
    ['LinkedIn', org.linkedin_url || '—'],
  ];
  body.appendTable(facts);
  body.appendParagraph(strategy.account_summary || '');

  body.appendParagraph('2. Competitive Landscape')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (competitors.length > 0) {
    const p = body.appendParagraph('');
    p.appendText('Competitor tech detected: ').setBold(true);
    p.appendText(competitors.join(', ')).setBold(false);
  }
  body.appendParagraph(strategy.competitive_landscape || '');

  body.appendParagraph('3. Pain Hypotheses')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  (strategy.pain_hypotheses || []).forEach(p =>
    body.appendListItem(p).setGlyphType(DocumentApp.GlyphType.BULLET));

  body.appendParagraph('4. PANW Product Fit')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  (strategy.panw_product_fit || []).forEach(p =>
    body.appendListItem(p).setGlyphType(DocumentApp.GlyphType.BULLET));

  body.appendParagraph('5. Recommended Entry Point')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(strategy.recommended_entry_point || '');

  body.appendParagraph('6. Strategic Rationale (Why Now)')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(strategy.strategic_rationale || '');

  body.appendParagraph('7. Target Contacts')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (contacts.length > 0) {
    const rows = [['Name', 'Title', 'Email', 'LinkedIn']];
    contacts.forEach(c => rows.push([
      [c.first_name, c.last_name].filter(Boolean).join(' '),
      c.title || '',
      c.email || '—',
      c.linkedin_url || '—',
    ]));
    body.appendTable(rows);
  } else {
    body.appendParagraph('No contacts identified in this pass.');
  }

  body.appendParagraph('8. Draft Outreach Emails')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  (strategy.draft_emails || []).forEach(email => {
    const to = body.appendParagraph('');
    to.appendText('To: ').setBold(true);
    let label = email.to_persona || '';
    if (email.to_name) label += ' (' + email.to_name + ')';
    to.appendText(label).setBold(false);

    const subj = body.appendParagraph('');
    subj.appendText('Subject: ').setBold(true);
    subj.appendText(email.subject || '').setBold(false);

    body.appendParagraph(email.body || '');

    const why = body.appendParagraph('');
    why.appendText('Why this angle: ' + (email.rationale || '')).setItalic(true);

    body.appendParagraph('');
  });

  body.appendParagraph('9. Next Steps')
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  (strategy.next_steps || []).forEach(s =>
    body.appendListItem(s).setGlyphType(DocumentApp.GlyphType.NUMBER));

  doc.saveAndClose();

  if (folderId) {
    try {
      const file = DriveApp.getFileById(doc.getId());
      const folder = DriveApp.getFolderById(folderId);
      file.moveTo(folder);
    } catch (e) {
      // folder move is optional; ignore failures
    }
  }

  return doc.getUrl();
}
