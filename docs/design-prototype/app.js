/* global document, window, setTimeout, clearTimeout, requestAnimationFrame */
const icons = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 2v3M18 2v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>',
  commitments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m8 12 2.5 2.5L16 9M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7.5h7l2-3h9v15H3z"/></svg>',
  memories: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 21a9 9 0 1 0-9-9v7l3-2M8 11h8M8 7h5M8 15h6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.6.66 1.02 1.27 1.02H21v4h-.09A1.65 1.65 0 0 0 19.4 15z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m5 12 14-7-5 14-2-6zM12 13l7-8"/></svg>',
  conflict: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 8v5M12 17h.01M10.3 3.6 2.6 18a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m5 12 4 4L19 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></svg>'
};

const navItems = [
  ['chat', 'Chat'], ['today', 'Today'], ['commitments', 'Commitments'],
  ['people', 'People'], ['projects', 'Projects'], ['memories', 'Memories']
];

const state = {
  route: 'chat',
  commitmentFilter: 'all',
  memoryFilter: '',
  selectedConflict: 'move-arun',
  dark: false
};

const main = document.getElementById('main');
const desktopNav = document.getElementById('desktop-nav');
const mobileNav = document.getElementById('mobile-nav');

function icon(name) { return icons[name] || ''; }
function avatar(name) {
  const cls = name.toLowerCase();
  return `<span class="avatar ${cls}">${name.slice(0, 2).toUpperCase()}</span>`;
}
function status(label, cls = 'pending') { return `<span class="status ${cls}">${label}</span>`; }

function renderNav() {
  desktopNav.innerHTML = navItems.map(([id, label]) => `<button class="nav-item ${state.route === id ? 'active' : ''}" data-route="${id}">${icon(id)}<span>${label}</span></button>`).join('');
  const mobileItems = [['chat','Chat'], ['today','Today'], ['commitments','Owed'], ['memories','Memory'], ['more','More']];
  mobileNav.innerHTML = mobileItems.map(([id,label]) => `<button class="mobile-tab ${state.route === id || (id === 'more' && ['people','projects','settings'].includes(state.route)) ? 'active' : ''}" data-route="${id}">${icon(id)}<span>${label}</span></button>`).join('');
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
}

function pageHeader(title, subtitle = '', eyebrow = '') {
  return `<header class="page-header"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1>${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ''}</div></header>`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function openSheet(content) {
  const backdrop = document.getElementById('sheet-backdrop');
  const sheet = document.getElementById('bottom-sheet');
  sheet.innerHTML = `<div class="sheet-handle"></div>${content}`;
  backdrop.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); });
}

function closeSheet() {
  const backdrop = document.getElementById('sheet-backdrop');
  const sheet = document.getElementById('bottom-sheet');
  backdrop.classList.remove('open'); sheet.classList.remove('open');
  setTimeout(() => { backdrop.hidden = true; sheet.hidden = true; }, 200);
}

function navigate(route) {
  if (route === 'more') { renderMoreSheet(); return; }
  state.route = route;
  window.location.hash = route;
  render();
  main.focus({preventScroll: true});
}

function conflictCard() {
  return `<div class="context-card">
    <div class="context-card-head"><div class="context-card-title">${icon('conflict')}<span>Schedule conflict</span></div><span class="meta-tag">Tomorrow</span></div>
    <div class="context-card-body">
      <div class="schedule-line"><div><div class="schedule-person">Hult meeting</div><div class="schedule-detail">With Karthik</div></div><div class="schedule-time">5:00 to 5:30 PM</div></div>
      <div class="schedule-line"><div><div class="schedule-person">Arun</div><div class="schedule-detail">Requested time</div></div><div class="schedule-time">5:00 PM</div></div>
    </div>
    <div class="context-card-actions">
      <button class="card-action" data-route="conflict">Move Arun</button>
      <button class="card-action" data-conflict-action="hult">Move Hult</button>
      <button class="card-action" data-conflict-action="both">Keep both</button>
    </div>
  </div>`;
}

function composer() {
  return `<div class="composer-wrap">
    <form class="composer" id="composer-form">
      <button type="button" class="composer-tool" data-action="attach" aria-label="Add attachment">${icon('plus')}</button>
      <textarea id="composer-input" rows="1" placeholder="Tell me anything..." aria-label="Message OurGlass"></textarea>
      <button type="button" class="composer-tool" data-action="voice" aria-label="Use voice">${icon('mic')}</button>
      <button type="submit" class="composer-tool composer-send" aria-label="Send">${icon('send')}</button>
    </form>
    <div class="composer-hint">OurGlass can remember, organize, and act on what you share.</div>
  </div>`;
}

function chatPage() {
  return `<section class="chat-page">
    <header class="chat-head"><div><h1>OurGlass</h1><div class="date">Thursday, September 17</div></div><button class="chat-profile" data-route="settings" aria-label="Open settings">KS</button></header>
    <div class="conversation" id="conversation">
      <div class="greeting"><div><div class="hello-kicker">17 September · Your world, in context</div><h2>Good<br>evening.</h2><p>Tell me what is happening.</p></div><div class="chat-illustration" aria-hidden="true"><span class="sun-disc"></span><span class="time-arch"></span><span class="memory-dot one"></span><span class="memory-dot two"></span><span class="memory-dot three"></span><span class="illustration-label">TODAY<br>5:00</span></div></div>
      <div class="message-group"><div class="message user">I finished the Hult poster.</div></div>
      <div class="message-group"><div class="message-label">OurGlass</div><div class="message assistant">Got it. Hult poster marked complete.</div>
        <div class="context-card"><div class="commitment-card"><div><div class="card-name">Hult poster</div><div class="card-meta">You owed Hult · Completed today</div></div>${status('Completed','done')}</div></div>
      </div>
      <div class="message-group"><div class="message user">Schedule Arun at 5 tomorrow.</div></div>
      <div class="message-group"><div class="message-label">OurGlass</div><div class="message assistant">5 PM tomorrow conflicts with your Hult meeting.</div>${conflictCard()}</div>
    </div>
    ${composer()}
  </section>`;
}

function todayPage() {
  return `<section class="page page-narrow">
    <header class="page-header day-header"><div><div class="eyebrow">Your day story</div><h1>Today</h1><p class="page-subtitle">September 17, 2026</p></div><div class="date-poster"><b>17</b><span>THU<br>SEP</span></div></header>
    <div class="section-title">Schedule</div>
    <div class="timeline">
      <div class="timeline-item"><div class="timeline-time">5:00 PM</div><div><div class="timeline-title">Meeting with Hult</div><div class="timeline-context">Karthik · Poster review</div></div><span class="meta-tag">30 min</span></div>
      <div class="timeline-item"><div class="timeline-time">6:00 PM</div><div><div class="timeline-title">Barkha's article due</div><div class="timeline-context">You will be reminded at 5 if it has not arrived</div></div>${status('Pending','pending')}</div>
    </div>
    <section class="section"><h2 class="section-title">Waiting on</h2><div class="rule-list">
      <div class="row"><div><div class="row-title">Arun · Backend schema</div><div class="row-subtitle">CRM · Due Friday</div></div>${status('Waiting','waiting')}</div>
    </div></section>
    <section class="section"><h2 class="section-title">Upcoming</h2><div class="rule-list">
      <div class="row"><div><div class="row-title">Hult poster handoff</div><div class="row-subtitle">Wednesday · Hult</div></div>${status('Ready','done')}</div>
    </div></section>
    <div class="subtle-callout">${icon('check')}<span>Nothing else needs your attention right now.</span></div>
  </section>`;
}

const commitments = [
  { person:'Barkha', item:'Article', relation:'Owes you', due:'Today · 6:00 PM', status:'Pending', cls:'pending', group:'to-me' },
  { person:'Arun', item:'Backend schema', relation:'Owes you', due:'Friday', status:'Waiting', cls:'waiting', group:'to-me' },
  { person:'You', item:'Hult poster', relation:'You owe', due:'Wednesday', status:'Completed', cls:'done', group:'by-me completed' },
  { person:'Karthik', item:'CRM brief feedback', relation:'Owes you', due:'Monday', status:'Pending', cls:'pending', group:'to-me' }
];

function commitmentsPage() {
  const tabs = [['all','All'],['to-me','Owed to me'],['by-me','Owed by me'],['completed','Completed']];
  const rows = commitments.filter(c => state.commitmentFilter === 'all' || c.group.includes(state.commitmentFilter)).map(c => `<div class="row commitment-row ${c.cls === 'done' ? 'completed-row' : ''}">
    <div class="person-cell">${avatar(c.person === 'You' ? 'Me' : c.person)}<div><div class="row-title">${c.person}</div><div class="relation-label">${c.relation}</div></div></div>
    <div><div class="row-title">${c.item}</div><div class="row-subtitle">${c.person === 'Arun' ? 'CRM' : c.person === 'Barkha' ? 'MTTN' : 'Hult'}</div></div>
    <div class="due-cell">${c.due}</div>${status(c.status,c.cls)}
  </div>`).join('');
  return `<section class="page">${pageHeader('Commitments','What people are counting on, in both directions.','Understood from conversation')}
    <div class="tabs">${tabs.map(([id,label]) => `<button class="tab ${state.commitmentFilter === id ? 'active' : ''}" data-commitment-filter="${id}">${label}</button>`).join('')}</div>
    <div class="rule-list">${rows || `<div class="empty-state"><h3>Nothing here</h3><p>When you mention a commitment, it will appear automatically.</p></div>`}</div>
  </section>`;
}

function peoplePage() {
  const people = [
    ['Arun','Backend · Batore','2 pending commitments','arun'],
    ['Barkha','Interviews · MTTN','1 pending commitment','barkha'],
    ['Karthik','CRM · Hult','Meeting tomorrow at 5','karthik'],
    ['Mira','Operations · Batore','No open commitments','mira']
  ];
  return `<section class="page">${pageHeader('People','The people in your world, understood from context.','People')}
    <div class="search" style="margin-bottom:24px">${icon('search')}<input type="search" placeholder="Find a person" aria-label="Find a person"></div>
    <div class="people-grid">${people.map(([name,role,stat]) => `<button class="person-card" data-route="person"><div class="person-card-top">${avatar(name)}<div><div class="person-name">${name}</div><div class="person-role">${role}</div></div></div><div class="person-card-stat">${stat}</div></button>`).join('')}</div>
  </section>`;
}

function personPage() {
  return `<section class="page page-narrow">
    <button class="detail-back" data-route="people">${icon('arrowLeft')} People</button>
    <header class="profile-header">${avatar('Arun')}<div><h1>Arun</h1><div class="profile-meta">Backend · Batore</div></div><button class="secondary-button" data-action="ask-arun">Ask OurGlass</button></header>
    <section class="section"><h2 class="section-title">Recent context</h2><div class="context-list">
      <div class="context-item">Discussed the backend schema.<div class="context-date">Today</div></div>
      <div class="context-item">Working on CRM with Karthik.<div class="context-date">September 15</div></div>
      <div class="context-item">Meeting requested for tomorrow at 5 PM.<div class="context-date">September 14</div></div>
    </div></section>
    <section class="section"><h2 class="section-title">Commitments</h2><div class="rule-list">
      <div class="row"><div><div class="row-title">Backend schema</div><div class="row-subtitle">Arun owes you · Due Friday</div></div>${status('Waiting','waiting')}</div>
      <div class="row"><div><div class="row-title">Review API endpoints</div><div class="row-subtitle">Arun owes you · Due Monday</div></div>${status('Pending','pending')}</div>
    </div></section>
    <section class="section"><h2 class="section-title">Relationships</h2><div class="relationship-tree"><strong>Arun</strong><br>├ &nbsp;Batore<br>├ &nbsp;CRM<br>└ &nbsp;Karthik</div></section>
  </section>`;
}

const memories = [
  { text:'Arun handles backend for CRM.', tags:['Arun','CRM'], date:'Today', route:'memory' },
  { text:'Barkha owes me the article.', tags:['Barkha','MTTN'], date:'Today', route:'memory' },
  { text:'Hult poster needs to be finished Wednesday.', tags:['Hult Poster'], date:'Sep 15', route:'memory' },
  { text:'Meeting with Karthik tomorrow at 5 PM.', tags:['Karthik','Hult'], date:'Sep 14', route:'memory' }
];

function memoriesPage() {
  const q = state.memoryFilter.toLowerCase();
  const results = memories.filter(m => m.text.toLowerCase().includes(q) || m.tags.join(' ').toLowerCase().includes(q));
  return `<section class="page page-narrow">${pageHeader('Memories','What OurGlass understands, with a clear source for every detail.','Memory')}
    <div class="search">${icon('search')}<input id="memory-search" type="search" value="${state.memoryFilter}" placeholder="Search memories..." aria-label="Search memories"></div>
    <section class="section"><h2 class="section-title">${q ? `${results.length} found` : 'Recent'}</h2><div class="rule-list" id="memory-results">
      ${results.map(m => `<div class="row memory-row clickable" data-route="${m.route}"><div><div class="memory-text">${m.text}</div><div class="memory-tags">${m.tags.map(t => `<span class="meta-tag">${t}</span>`).join('')}</div></div><div class="memory-date">${m.date}</div></div>`).join('') || `<div class="empty-state"><h3>No matching memories</h3><p>Try a person, project, or phrase you remember using.</p></div>`}
    </div></section>
  </section>`;
}

function memoryPage() {
  return `<section class="page page-narrow">
    <button class="detail-back" data-route="memories">${icon('arrowLeft')} Memories</button>
    <div class="eyebrow">Confirmed memory</div>
    <div class="memory-detail-quote">“Arun handles backend for CRM.”</div>
    <div class="facts">
      <div class="fact"><div class="fact-label">Source</div><div>Conversation · September 7, 2026</div></div>
      <div class="fact"><div class="fact-label">Related to</div><div>Arun · CRM · Batore</div></div>
      <div class="fact"><div class="fact-label">Understood as</div><div>Confirmed by you</div></div>
      <div class="fact"><div class="fact-label">Last used</div><div>Today, when checking the backend schema</div></div>
    </div>
    <div class="correction-box"><p>If this is no longer right, tell OurGlass what changed.</p><form class="correction-input" id="correction-form"><input name="correction" placeholder="For example, Karthik handles it now" aria-label="Correct this memory"><button class="secondary-button" type="submit">Correct</button></form></div>
    <div class="button-row" style="margin-top:18px"><button class="text-button" data-action="forget-memory">Forget this memory</button></div>
  </section>`;
}

function projectsPage() {
  return `<section class="page">${pageHeader('Projects','Context gathered from conversations, people, and files.','Projects')}
    <div class="project-list">
      <button class="project-card" data-route="project"><div class="project-title"><span>Hult Poster</span>${icon('arrowRight')}</div><div class="project-org">Hult</div><div class="project-summary">Poster completed today<br>Meeting tomorrow · 5:00 PM<br>Latest brief attached</div><div class="project-people">${avatar('Karthik')}${avatar('Barkha')}</div><span class="project-glyph">H</span></button>
      <button class="project-card" data-route="project"><div class="project-title"><span>CRM</span>${icon('arrowRight')}</div><div class="project-org">Batore</div><div class="project-summary">Waiting for backend schema<br>2 open commitments<br>Latest update today</div><div class="project-people">${avatar('Arun')}${avatar('Karthik')}</div><span class="project-glyph">C</span></button>
    </div>
  </section>`;
}

function projectPage() {
  return `<section class="page project-detail-page">
    <button class="detail-back" data-route="projects">${icon('arrowLeft')} Projects</button>
    <header class="project-cover"><div class="project-cover-copy"><div class="project-cover-label">Hult · Active project</div><h1>HULT<br>POSTER</h1><p>A visual campaign shaped with Karthik and Barkha.</p></div><div class="project-art" aria-hidden="true"><span class="poster-sheet one">H</span><span class="poster-sheet two">17</span><span class="poster-ring"></span></div></header>
    <div class="project-detail-grid">
      <section class="project-detail-block people-block"><h2>People</h2><div class="big-people"><div>${avatar('Karthik')}<b>Karthik</b></div><div>${avatar('Barkha')}<b>Barkha</b></div></div></section>
      <section class="project-detail-block commitment-block"><div class="block-kicker">Commitment</div><h2>Poster handoff</h2><p>Completed today</p>${status('Ready','done')}</section>
      <section class="project-detail-block context-block"><div class="block-kicker">Latest context</div><blockquote>“Use the final copy from Karthik and keep the venue line.”</blockquote><p>Conversation · Today</p></section>
      <section class="project-detail-block document-block"><div class="block-kicker">Document</div><div class="document-object"><span>PDF</span><b>Hult brief.pdf</b><small>2.4 MB · Sep 15</small></div></section>
    </div>
  </section>`;
}

function conflictPage() {
  const choices = [
    ['move-arun','Move Arun','OurGlass found the nearest open time','4:00 to 4:30 PM'],
    ['move-hult','Move Hult','Keep Arun at the requested time','Find a time'],
    ['keep-both','Keep both','Leave both events at 5 PM','No changes']
  ];
  return `<section class="page page-narrow">
    <button class="detail-back" data-route="chat">${icon('arrowLeft')} Conversation</button>
    ${pageHeader('Two plans overlap.','Choose what you would like to change.','Tomorrow · Friday, September 18')}
    <div class="conflict-layout"><div class="appointment"><div class="appointment-label">Already scheduled</div><h3>Hult meeting</h3><p>5:00 to 5:30 PM · Karthik</p></div><div class="appointment requested"><div class="appointment-label">Requested</div><h3>Meeting with Arun</h3><p>5:00 PM · Duration not specified</p></div></div>
    <div class="choice-list">${choices.map(([id,title,sub,time]) => `<button class="choice ${state.selectedConflict === id ? 'selected' : ''}" data-choice="${id}"><span class="choice-radio"></span><span><span class="choice-title">${title}</span><span class="choice-sub">${sub}</span></span><span class="choice-time">${time}</span></button>`).join('')}</div>
    <div class="apply-bar"><div class="apply-note">Nothing changes until you confirm.</div><button class="primary-button" data-action="apply-conflict">Apply change</button></div>
  </section>`;
}

function settingsPage() {
  return `<section class="page page-narrow">${pageHeader('Settings','Control how OurGlass remembers and acts.','Preferences')}
    <section><h2 class="section-title">Appearance</h2><div class="settings-group">
      <div class="setting"><div><div class="setting-title">Dark appearance</div><div class="setting-sub">Use a deep neutral palette in low light</div></div><button class="toggle ${state.dark ? 'on' : ''}" data-action="toggle-dark" aria-label="Toggle dark appearance"></button></div>
    </div></section>
    <section><h2 class="section-title">Memory</h2><div class="settings-group">
      <div class="setting"><div><div class="setting-title">Remember conversation context</div><div class="setting-sub">Let OurGlass connect people, commitments, and projects over time</div></div><button class="toggle on" data-action="toggle"></button></div>
      <div class="setting"><div><div class="setting-title">Ask before uncertain updates</div><div class="setting-sub">Clarify when a meaningful detail could be misunderstood</div></div><button class="toggle on" data-action="toggle"></button></div>
      <div class="setting"><div><div class="setting-title">Review remembered details</div><div class="setting-sub">Inspect, correct, or forget anything at any time</div></div><button class="text-button" data-route="memories">View memories</button></div>
    </div></section>
    <section><h2 class="section-title">Actions and permissions</h2><div class="settings-group">
      <div class="setting"><div class="integration"><span class="integration-icon">G</span><div><div class="setting-title">Google Calendar</div><div class="setting-sub">Always allow calendar creation</div></div></div><select class="select" aria-label="Google Calendar permission"><option>Always allow</option><option>Ask every time</option><option>Not connected</option></select></div>
      <div class="setting"><div class="integration"><span class="integration-icon">M</span><div><div class="setting-title">Email</div><div class="setting-sub">Review messages before they are sent</div></div></div><select class="select" aria-label="Email permission"><option>Confirm before sending</option><option>Always allow</option><option>Not connected</option></select></div>
      <div class="setting"><div class="integration"><span class="integration-icon">D</span><div><div class="setting-title">Google Drive</div><div class="setting-sub">Find and read files you ask about</div></div></div><select class="select" aria-label="Drive permission"><option>Read only</option><option>Ask every time</option><option>Not connected</option></select></div>
    </div></section>
  </section>`;
}

function reminderPage() {
  return `<section class="page page-narrow">
    <button class="detail-back" data-route="chat">${icon('arrowLeft')} Conversation</button>
    <div style="text-align:center;padding-top:12vh">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--sage-soft);color:var(--sage);display:grid;place-items:center;margin:0 auto 22px">${icon('check')}</div>
      <h1 style="font-size:28px">Reminder set</h1>
      <p class="page-subtitle" style="max-width:320px;margin:10px auto 0">At 5 PM today, if Barkha has not sent the article, I will remind you to ask her.</p>
      <div class="button-row" style="justify-content:center;margin-top:28px"><button class="primary-button" data-route="chat">Done</button><button class="secondary-button" data-action="change-reminder">Change</button></div>
    </div>
  </section>`;
}

function renderMoreSheet() {
  openSheet(`<h2 class="sheet-title">More</h2><p class="sheet-copy">Inspect the people, projects, and settings OurGlass understands.</p><div class="upload-options">
    <button class="upload-option" data-sheet-route="people">${icon('people')}<span>People</span></button>
    <button class="upload-option" data-sheet-route="projects">${icon('projects')}<span>Projects</span></button>
    <button class="upload-option" data-sheet-route="settings">${icon('settings')}<span>Settings</span></button>
  </div>`);
}

const pages = { chat: chatPage, today: todayPage, commitments: commitmentsPage, people: peoplePage, person: personPage, memories: memoriesPage, memory: memoryPage, projects: projectsPage, project: projectPage, conflict: conflictPage, settings: settingsPage, reminder: reminderPage };

function render() {
  const page = pages[state.route] || chatPage;
  main.innerHTML = page();
  renderNav();
  bindPageEvents();
  if (state.route === 'chat') {
    const c = document.getElementById('conversation');
    c.scrollTop = c.scrollHeight;
  }
}

function bindPageEvents() {
  const composerForm = document.getElementById('composer-form');
  if (composerForm) composerForm.addEventListener('submit', handleComposer);

  const textarea = document.getElementById('composer-input');
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 108)}px`;
    });
    textarea.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composerForm.requestSubmit(); }
    });
  }

  document.querySelectorAll('[data-commitment-filter]').forEach(button => button.addEventListener('click', () => {
    state.commitmentFilter = button.dataset.commitmentFilter;
    render();
  }));

  document.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
    state.selectedConflict = button.dataset.choice;
    render();
  }));

  const memorySearch = document.getElementById('memory-search');
  if (memorySearch) memorySearch.addEventListener('input', event => {
    state.memoryFilter = event.target.value;
    const q = state.memoryFilter.toLowerCase();
    const results = memories.filter(m => m.text.toLowerCase().includes(q) || m.tags.join(' ').toLowerCase().includes(q));
    document.getElementById('memory-results').innerHTML = results.map(m => `<div class="row memory-row clickable" data-route="${m.route}"><div><div class="memory-text">${m.text}</div><div class="memory-tags">${m.tags.map(t => `<span class="meta-tag">${t}</span>`).join('')}</div></div><div class="memory-date">${m.date}</div></div>`).join('') || `<div class="empty-state"><h3>No matching memories</h3><p>Try a person, project, or phrase you remember using.</p></div>`;
  });

  const correctionForm = document.getElementById('correction-form');
  if (correctionForm) correctionForm.addEventListener('submit', event => {
    event.preventDefault();
    const input = correctionForm.elements.correction;
    if (!input.value.trim()) return;
    showToast('Memory corrected');
    input.value = '';
  });
}

function addChatMessage(userText, assistantText, card = '') {
  const conversation = document.getElementById('conversation');
  conversation.insertAdjacentHTML('beforeend', `<div class="message-group"><div class="message user"></div></div><div class="message-group"><div class="message-label">OurGlass</div><div class="message assistant"></div>${card}</div>`);
  const groups = conversation.querySelectorAll('.message-group');
  groups[groups.length - 2].querySelector('.message').textContent = userText;
  groups[groups.length - 1].querySelector('.message.assistant').textContent = assistantText;
  conversation.scrollTo({top: conversation.scrollHeight, behavior:'smooth'});
}

function handleComposer(event) {
  event.preventDefault();
  const input = document.getElementById('composer-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  const lower = text.toLowerCase();
  let reply = 'Got it.';
  let card = '';

  if (lower.includes('her') && lower.includes('send')) {
    reply = 'Who do you mean by “her”?';
  } else if (lower.includes('arun') && lower.includes('poster') && lower.includes('remind')) {
    reply = 'Arun from Batore or Arun from MTTN?';
  } else if (lower.includes('remind') && lower.includes('barkha')) {
    reply = 'Done. I will remind you at 5 if Barkha has not sent it.';
    card = `<div class="context-card"><div class="commitment-card"><div><div class="card-name">Ask Barkha about the article</div><div class="card-meta">Today · 5:00 PM · Only if not received</div></div>${status('Set','done')}</div><div class="context-card-actions"><button class="card-action" data-route="reminder">View reminder</button></div></div>`;
  } else if (lower.includes('arun') && lower.includes('5')) {
    reply = '5 PM tomorrow conflicts with your Hult meeting.';
    card = conflictCard();
  } else if (lower.includes('finished') || lower.includes('complete')) {
    reply = 'Got it. I marked that complete.';
  } else if (lower.includes('arun') && (lower.includes('schema') || lower.includes("hasn't"))) {
    reply = 'Still waiting on Arun for the backend schema.';
    card = `<div class="context-card"><div class="commitment-card"><div><div class="card-name">Backend schema</div><div class="card-meta">Waiting on Arun · Due Friday</div></div>${status('Waiting','waiting')}</div></div>`;
  }
  addChatMessage(text, reply, card);
}

document.addEventListener('click', event => {
  const routeTarget = event.target.closest('[data-route]');
  if (routeTarget) { navigate(routeTarget.dataset.route); return; }

  const sheetRoute = event.target.closest('[data-sheet-route]');
  if (sheetRoute) { closeSheet(); setTimeout(() => navigate(sheetRoute.dataset.sheetRoute), 120); return; }

  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;

  if (action === 'attach') {
    openSheet(`<h2 class="sheet-title">Share something</h2><p class="sheet-copy">OurGlass will read it for context. Nothing will be scheduled or sent without a clear request.</p><div class="upload-options"><button class="upload-option" data-upload="photo">${icon('image')}<span>Photo or screenshot</span></button><button class="upload-option" data-upload="document">${icon('file')}<span>Document or PDF</span></button></div>`);
  } else if (action === 'voice') {
    actionTarget.classList.toggle('active');
    actionTarget.innerHTML = actionTarget.classList.contains('active') ? icon('check') : icon('mic');
    showToast(actionTarget.classList.contains('active') ? 'Listening' : 'Voice stopped');
  } else if (action === 'toggle-dark') {
    state.dark = !state.dark; document.body.classList.toggle('dark', state.dark); render();
  } else if (action === 'toggle') {
    actionTarget.classList.toggle('on');
  } else if (action === 'apply-conflict') {
    showToast(state.selectedConflict === 'move-arun' ? 'Arun moved to 4:00 PM' : state.selectedConflict === 'move-hult' ? 'Choose a new Hult time in chat' : 'Both events kept at 5:00 PM');
    setTimeout(() => navigate('chat'), 700);
  } else if (action === 'forget-memory') {
    openSheet(`<h2 class="sheet-title">Forget this memory?</h2><p class="sheet-copy">OurGlass will stop using this detail in future conversations. The original conversation will stay in your history.</p><div class="button-row"><button class="primary-button" data-confirm-forget>Forget memory</button><button class="secondary-button" data-close-sheet>Cancel</button></div>`);
  } else if (action === 'ask-arun') {
    navigate('chat');
    setTimeout(() => { document.getElementById('composer-input').value = 'What do I know about Arun?'; document.getElementById('composer-input').focus(); }, 50);
  } else if (action === 'change-reminder') {
    openSheet(`<h2 class="sheet-title">Change reminder</h2><p class="sheet-copy">Tell OurGlass what should be different.</p><form id="sheet-reminder-form" class="correction-input"><input placeholder="For example, remind me at 4:30" aria-label="Change reminder"><button class="primary-button">Update</button></form>`);
  } else if (action.startsWith('project-')) {
    showToast('Project context opened in conversation');
  }
});

document.addEventListener('click', event => {
  if (event.target.closest('[data-close-sheet]') || event.target.id === 'sheet-backdrop') closeSheet();
  if (event.target.closest('[data-upload]')) {
    closeSheet();
    setTimeout(() => showToast('Ready to choose a file'), 180);
  }
  if (event.target.closest('[data-confirm-forget]')) {
    closeSheet(); showToast('Memory forgotten'); setTimeout(() => navigate('memories'), 500);
  }
  if (event.target.closest('[data-conflict-action]')) {
    const action = event.target.closest('[data-conflict-action]').dataset.conflictAction;
    state.selectedConflict = action === 'hult' ? 'move-hult' : 'keep-both';
    navigate('conflict');
  }
});

document.addEventListener('submit', event => {
  if (event.target.id === 'sheet-reminder-form') {
    event.preventDefault(); closeSheet(); showToast('Reminder updated');
  }
});

document.getElementById('sheet-backdrop').addEventListener('click', closeSheet);

const initialHash = window.location.hash.replace('#','');
if (pages[initialHash]) state.route = initialHash;
render();
