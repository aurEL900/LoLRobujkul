import axios from "axios";
import fs from "fs";

const creds = JSON.parse(fs.readFileSync('bot_credentials.json', 'utf-8'));
const apiKey = creds.RIOT_API_KEY;

async function riotRequest(url: string, apiKey: string, retries = 3, backoff = 1000, silent404 = false, silent403 = false): Promise<any> {
  try {
    return await axios.get(url, {
      headers: { 'X-Riot-Token': apiKey },
      timeout: 10000 // 10 second timeout
    });
  } catch (error: any) {
    const status = error.response?.status;
    const code = error.code;
    
    if (error.response) {
      const errorData = JSON.stringify(error.response.data);
      const isSilent = (status === 404 && silent404) || (status === 403 && silent403);
      
      if (!isSilent || status === 403) {
        console.error(`Riot API Error [${status}] at ${url}:`, errorData);
      }
      
      if (status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        if (retryAfter) {
          const delay = parseInt(retryAfter) * 1000;
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return riotRequest(url, apiKey, retries - 1, backoff, silent404, silent403);
          }
        }
      }
    }
    
    if (retries > 0 && (!error.response || (status >= 500 && status < 600))) {
      await new Promise(resolve => setTimeout(resolve, backoff));
      return riotRequest(url, apiKey, retries - 1, backoff * 2, silent404, silent403);
    }
    
    throw error;
  }
}

async function getRecentMatchStats(region: string, gameName: string, tagLine: string) {
  const regionMap: Record<string, { routing: string, platforms: string[] }> = {
    'americas': { routing: 'americas', platforms: ['na1', 'br1', 'la1', 'la2', 'pbe1'] },
    'europe': { routing: 'europe', platforms: ['euw1', 'eun1', 'tr1', 'ru', 'me1'] },
    'asia': { routing: 'asia', platforms: ['kr', 'jp1'] },
    'sea': { routing: 'sea', platforms: ['oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2'] }
  };

  const platformAliases: Record<string, string> = {
    'na': 'na1', 'euw': 'euw1', 'eune': 'eun1', 'lan': 'la1', 'las': 'la2',
    'br': 'br1', 'tr': 'tr1', 'ru': 'ru', 'jp': 'jp1', 'kr': 'kr', 'oc': 'oc1', 'oce': 'oc1', 'me': 'me1',
    'ph': 'ph2', 'sg': 'sg2', 'th': 'th2', 'tw': 'tw2', 'vn': 'vn2',
    'lan1': 'la1', 'las1': 'la2', 'ph1': 'ph2', 'sg1': 'sg2', 'th1': 'th2', 'tw1': 'tw2', 'vn1': 'vn2',
    'pbe': 'pbe1', 'sea': 'sg2'
  };

  let platform = region.toLowerCase();
  const defaultRegion = creds.DEFAULT_RIOT_REGION || 'na1';
  
  if (!platform || platform === 'default') {
    platform = defaultRegion;
  }
  
  platform = platformAliases[platform] || platform;

  let initialRouting = 'americas';
  for (const r in regionMap) {
    if (regionMap[r].platforms.includes(platform)) {
      initialRouting = regionMap[r].routing;
      break;
    }
  }

  const routingRegions = ['americas', 'europe', 'asia', 'sea'];
  const routingsToTry = [initialRouting, ...routingRegions.filter(r => r !== initialRouting)];

  let puuid = '';
  let finalRouting = '';
  let forbiddenRegions: string[] = [];

  for (const routing of routingsToTry) {
    try {
      const accountRes = await riotRequest(`https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, apiKey, 3, 1000, true, true);
      puuid = accountRes.data.puuid;
      finalRouting = routing;
      break;
    } catch (e: any) {
      if (e.status === 404) continue;
      if (e.status === 403) {
        forbiddenRegions.push(routing);
        continue;
      }
      throw e;
    }
  }

  if (!puuid) {
    if (forbiddenRegions.length > 0) {
      throw new Error(`Player ${gameName}#${tagLine} not found. (Note: Access to ${forbiddenRegions.join(', ')} was restricted by your API key)`);
    }
    throw new Error(`Player ${gameName}#${tagLine} not found in any Riot region. Double-check the Name#Tag.`);
  }

  // Fetch last 3 match IDs
  let matchIds: string[] = [];
  try {
    const matchIdsRes = await riotRequest(`https://${finalRouting}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=3`, apiKey, 2, 1000, true, true);
    matchIds = matchIdsRes.data || [];
  } catch (e: any) {
    if (e.status === 404) return "No recent matches found for this player.";
    throw e;
  }

  if (!matchIds || matchIds.length === 0) {
    return "No recent matches found for this player.";
  }

  // Fetch match details
  let statsStrings = [];
  for (const matchId of matchIds) {
    try {
      const matchRes = await riotRequest(`https://${finalRouting}.api.riotgames.com/lol/match/v5/matches/${matchId}`, apiKey, 2, 1000, true, false);
      const participant = matchRes.data.info.participants.find((p: any) => p.puuid === puuid);
      if (participant) {
        const result = participant.win ? 'Win' : 'Loss';
        const kda = `${participant.kills}/${participant.deaths}/${participant.assists}`;
        statsStrings.push(`${participant.championName} (${result}, ${kda})`);
      }
    } catch (e) {
      console.error(`Failed to fetch match ${matchId}`, e);
    }
  }

  if (statsStrings.length === 0) return "Could not retrieve match details.";

  return `Recent games: ${statsStrings.join(' | ')}`;
}

async function test() {
  try {
    console.log(await getRecentMatchStats('default', 'BN Anujkut', 'TACI'));
  } catch (e: any) {
    console.error("ERROR:", e.message);
  }
}

test();
