// scripts/fetch.js
import fs from 'fs/promises';
import {eventIconString, crowDistance, dateToUnix, compUrl, compStartTime} from './utility_function.js'
import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config'; // If using ESM
import { createClient } from '@supabase/supabase-js'

const apiv0 = 'https://www.worldcubeassociation.org/api/v0'
const davisCoords = { latitude: 38.5427, longitude: -121.75797 };
const role = "1341617955053506570"

function sleep(ms) {
  sleep.counter = (sleep.counter || 0) + 1;
  console.log(`⏳ Sleep #${sleep.counter}: waiting ${ms / 1000}s…`);
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

      const looksLikeJson = ctype.includes('application/json') && !text.trim().startsWith('<');

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

function getRegistrationState(comp){
  const now = Date.now();
  const { openTime, closeTime } = comp.registrationInfo;
  const open = new Date(openTime).getTime();
  const close = new Date(closeTime).getTime();
  const sixH = 6 * 60 * 60 * 1000;

  if (now < open) { return 'notOpen';}
  return (close - now > sixH) ? 'open' : 'closing';
}

async function main() {
  // login
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  await client.login(process.env.DISCORD_BOT_TOKEN);
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  //supabase
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

  // create files if needed
  await fs.mkdir('api/comps', { recursive: true });
  await fs.writeFile('api/comps.json', '[]', { flag: 'wx' }).catch(() => {});
  await fs.writeFile('api/regState.json', '[]', { flag: 'wx' }).catch(() => {});

  const existingComps = await readJSON('api/comps.json');
  const existingRegState = await readJSON('api/regState.json');
  const existingIds = existingComps.map(comp=>comp.id)

  const ids = await compids();
  let newIds  = [];
  let comps = []
  let newRegs = {};

  let regState = [];
  let regStateChanges = [];

  for (const id of ids) {
    const wcif = await fetchJson(`${apiv0}/competitions/${id}/wcif/public`);
    if (!wcif) {
      console.warn(`↷ Skipping ${id}`);
      continue;                          
    }
    await fs.writeFile(`api/comps/${id}.json`, JSON.stringify(wcif, null, 2));
    
    const trimmed = {
      id: wcif.id,
      startDate: wcif.schedule.startDate,
      latitude: wcif.schedule.venues[0].latitudeMicrodegrees,
      longitude: wcif.schedule.venues[0].longitudeMicrodegrees,
      events: wcif.events.map(event => event.id),
      registrations: wcif.persons.map(person => person.wcaId).filter(id => id!=null)
    }
    comps.push(trimmed)
    const close = crowDistance(davisCoords.latitude, davisCoords.longitude, wcif.schedule.venues[0].latitudeMicrodegrees/1e6, wcif.schedule.venues[0].longitudeMicrodegrees/1e6) < 300;
    
    //handle new comp
    if (!existingIds.includes(id)) {
      newIds.push(id);
      if (close) {
        const icons = await Promise.all(wcif.events.map(event => eventIconString(client, event.id)));
        const iconString = icons.join('');
        await channel.send(`<@&${role}> [${wcif.name}](<${compUrl(wcif)}>) is happening on <t:${dateToUnix(compStartTime(wcif))}:D> featuring ${iconString}`);
      }
    }

    const { data, error } = await supabase.from('users').select('wca_id');
    const wcaIds = new Set(data.map(user => user.wca_id))

    // handle new registrations
    const prevReg = existingComps.find(c => c.id === id)?.registrations ?? [];
    const newReg = trimmed.registrations.filter(id => !prevReg.includes(id));
    const newRegClub = newReg.filter(id => wcaIds.has(id));
    if (newReg.length) {
      newRegs[id] = newReg;
    }
    if (newRegClub.length) {
      const names = newRegClub.map(id=>`${wcif.persons.find(person => person.wcaId===id).name}`).join(", ")
      await channel.send(`${names} just registered for [${wcif.name}](<${compUrl(wcif)}>)`);
    }

    // handle registration state
    const prevRegState = existingRegState.find(comp => comp.id === wcif.id)?.state ?? 'notOpen';
    const newRegState = getRegistrationState(wcif);
    regState.push({id: wcif.id, state: newRegState})

    if (prevRegState !== newRegState) {
      regStateChanges.push({id: wcif.id, state: newRegState})
      if (close || newRegClub.length > 1)
        if (newRegState=="open") {
          await channel.send(`<@&${role}> Registration for [${wcif.name}](<${compUrl(wcif)}>) has opened <t:${dateToUnix(wcif.registrationInfo.openTime)}:R>!`);
        }
        else if (newRegState=="closing") {
          await channel.send(`<@&${role}> Registration for [${wcif.name}](<${compUrl(wcif)}>) closes in <t:${dateToUnix(wcif.registrationInfo.closeTime)}:R>`);
        }    
    }
  }

  await fs.writeFile('api/newRegs.json', JSON.stringify(newRegs, null, 2));
  await fs.writeFile(`api/comps.json`, JSON.stringify(comps, null, 2));
  await fs.writeFile('api/newComps.json', JSON.stringify(newIds, null, 2));
  await fs.writeFile(`api/regState.json`, JSON.stringify(regState, null, 2));
  await fs.writeFile(`api/regStateChanges.json`, JSON.stringify(regStateChanges, null, 2));

  const timestamp = { lastRun: new Date().toISOString() };
  await fs.writeFile('api/timestamp.json', JSON.stringify(timestamp, null, 2));

  await client.destroy();
}

main().catch(err => {
  console.error('❌ Test setup failed:', err);
  process.exit(1);
});
