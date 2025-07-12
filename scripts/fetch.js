// scripts/fetch.js
import fs from 'fs/promises';

const apiv0 = 'https://www.worldcubeassociation.org/api/v0'

function sleep(ms) {
  // initialize the static counter the first time we call sleep()
  sleep.counter = (sleep.counter || 0) + 1;

  console.log(
    `⏳ Sleep #${sleep.counter}: waiting ${ms / 1000}s…`
  );

  return new Promise(resolve => setTimeout(resolve, ms));
}


async function fetchJson(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res  = await fetch(url);
      await sleep(1000);                   

      const ctype = res.headers.get('content-type') ?? 'unknown';
      const text  = await res.text();

      console.log(`🔎 [${attempt}/${maxRetries}] ${url} → ${res.status} (${ctype})`);

      const looksLikeJson =
        ctype.includes('application/json') && !text.trim().startsWith('<');

      if (res.ok && looksLikeJson) {
        return JSON.parse(text);
      }

      console.warn(`⚠️ Non-JSON body\n`);
    } catch (err) {
      console.warn(`❌ Network/parsing error; retrying in 1 s…\n${err}`);
    }
  }
  return null;
}

async function readJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function compids() {
  let ids = [];
  let page = 1;

  while (true) {
    const today = new Date().toISOString().split('T')[0];
    const json = await fetchJson(
      `${apiv0}/competition_index?&include_cancelled=false&sort=start_date%2Cend_date%2Cname&ongoing_and_future=${today}&page=${page}`
    );
    if (json.length == 0) {
        return ids;
    }
    ids.push(...json.map(comp => comp.id));
    page++;
    
  }
}

async function main() {
  await fs.mkdir('api/comps', { recursive: true });
  await fs.writeFile('api/comps.json', '[]', { flag: 'wx' }).catch(() => {});

  const existingComps = await readJSON('api/comps.json');
  const existingIds = existingComps.map(comp=>comp.id)

  const ids = await compids();
  let newIds  = [];
  let comps = []
  let newRegs = {};
  
  for (const id of ids) {
    const wcif = await fetchJson(`${apiv0}/competitions/${id}/wcif/public`);
      if (!wcif) {
        console.warn(`↷ Skipping ${id}`);

        continue;                          
      }

    const trimmed = {
      id: wcif.id,
      startDate: wcif.schedule.startDate,
      latitude: wcif.schedule.venues[0].latitudeMicrodegrees,
      longitude: wcif.schedule.venues[0].longitudeMicrodegrees,
      events: wcif.events.map(event => event.id),
      registrations: wcif.persons.map(person => person.wcaId).filter(person => person!=null)
    }
    comps.push(trimmed)

    if (!existingIds.includes(id)) {
      newIds.push(id);
    }

    const prevReg = existingComps.find(c => c.id === id)?.registrations ?? [];
    const prevSet = new Set(prevReg);
    const newReg = trimmed.registrations.filter(id => !prevSet.has(id));
    
    if (newReg.length) {
      newRegs[id] = newReg;
    }
    await fs.writeFile(`api/comps/${id}.json`, JSON.stringify(wcif, null, 2));
  }

  await fs.writeFile('api/newRegs.json', JSON.stringify(newRegs, null, 2));
  await fs.writeFile(`api/comps.json`, JSON.stringify(comps, null, 2));
  await fs.writeFile('api/newComps.json', JSON.stringify(newIds, null, 2));

  const timestamp = { lastRun: new Date().toISOString() };
  await fs.writeFile('api/timestamp.json', JSON.stringify(timestamp, null, 2));
}

main().catch(err => {
  console.error('❌ Test setup failed:', err);
  process.exit(1);
});
