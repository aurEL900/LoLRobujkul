import express from 'express';
import { createServer as createViteServer } from 'vite';
import tmi from 'tmi.js';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { GoogleGenAI } from '@google/genai';
import { exec } from 'child_process';
import { promisify } from 'util';
import admin from 'firebase-admin';

const execAsync = promisify(exec);

const app = express();
app.use(express.json()); // Add JSON body parsing for admin panel
const PORT = 3000;

import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;
try {
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
  admin.initializeApp({
    credential: admin.credential.applicationDefault(), // Fallback to default
    projectId: firebaseConfig.projectId
  });
  
  // If using a named database
  if (firebaseConfig.firestoreDatabaseId) {
    db = getFirestore(firebaseConfig.firestoreDatabaseId);
  } else {
    db = getFirestore();
  }
  console.log('Firebase Admin initialized');
} catch (e) {
  console.error('Failed to initialize Firebase Admin:', e);
}

// File paths for persistence
const LOG_FILE = path.join(process.cwd(), 'bot.log');
const MOD_FILE = path.join(process.cwd(), 'mod_config.json');
const CRED_FILE = path.join(process.cwd(), 'bot_credentials.json');
const CHAT_FILE = path.join(process.cwd(), 'chat_history.log');
const STATS_FILE = path.join(process.cwd(), 'bot_stats.json');
const CUSTOM_CMDS_FILE = path.join(process.cwd(), 'custom_commands.json');
const WELCOMED_FILE = path.join(process.cwd(), 'welcomed_users.json');

// Credentials State
let customCreds: Record<string, string> = {};

async function loadCreds() {
  try {
    if (fs.existsSync(CRED_FILE)) {
      const data = await fsPromises.readFile(CRED_FILE, 'utf-8');
      customCreds = JSON.parse(data);
    }

    // Auto-implement Gemini Key from environment if missing or placeholder
    const currentGemini = customCreds['GEMINI_API_KEY'];
    const isPlaceholder = !currentGemini || currentGemini === 'MY_GEMINI_API_KEY' || currentGemini.includes('TODO');
    
    if (isPlaceholder && process.env['GEMINI_API_KEY']) {
      customCreds['GEMINI_API_KEY'] = process.env['GEMINI_API_KEY'];
      await fsPromises.writeFile(CRED_FILE, JSON.stringify(customCreds, null, 2));
      addLog('Auto-implemented Gemini API Key from environment.', 'INFO');
    }
  } catch (e) {
    console.error('Failed to load credentials:', e);
  }
}
async function initBot() {
  await loadCreds();
  await loadWelcomedUsers();
  await loadModConfig();
  await loadStats();
  await loadCustomCommands();
  await loadChatHistory();
  
  // Initialize Twitch client after creds are loaded
  initTwitch();
}
initBot();

function getCred(key: string): string {
  const stored = customCreds[key];
  const env = process.env[key];
  
  const isPlaceholder = (val: string | undefined) => 
    !val || val === 'MY_GEMINI_API_KEY' || val.includes('TODO') || val === 'YOUR_RIOT_API_KEY';

  if (isPlaceholder(stored)) {
    return env || '';
  }
  
  return stored || env || '';
}

// Moderation State
let evasionPatterns: string[] = [];
let autoPunish = false;
let welcomeEnabled = false;
let welcomeMessage = 'Welcome to the stream, @user! Hope you have a great time!';
let rankTemplate = "{game_name}'s Ranks | LoL: {lol_rank} | TFT: {tft_rank}";
let authorizedUsers: string[] = [];
let authorizedEmails: string[] = [];
let extraCommandsInstalled = false;
let welcomedUsers = new Set<string>();

// Load Welcomed Users
async function loadWelcomedUsers() {
  try {
    if (fs.existsSync(WELCOMED_FILE)) {
      const data = await fsPromises.readFile(WELCOMED_FILE, 'utf-8');
      welcomedUsers = new Set(JSON.parse(data));
    }
  } catch (e) {
    console.error('Failed to load welcomed users:', e);
  }
}
async function saveWelcomedUsers() {
  try {
    await fsPromises.writeFile(WELCOMED_FILE, JSON.stringify(Array.from(welcomedUsers)));
  } catch (e) {
    console.error('Failed to save welcomed users:', e);
  }
}

// Load Mod Config
async function loadModConfig() {
  try {
    if (fs.existsSync(MOD_FILE)) {
      const data = await fsPromises.readFile(MOD_FILE, 'utf-8');
      const config = JSON.parse(data);
      evasionPatterns = config.evasionPatterns || [];
      autoPunish = config.autoPunish || false;
      welcomeEnabled = config.welcomeEnabled || false;
      welcomeMessage = config.welcomeMessage || 'Welcome to the stream, @user! Hope you have a great time!';
      rankTemplate = config.rankTemplate || "{game_name}'s Ranks | LoL: {lol_rank} | TFT: {tft_rank}";
      authorizedUsers = config.authorizedUsers || [];
      authorizedEmails = config.authorizedEmails || [];
    }
  } catch (e) {
    console.error('Failed to load mod config:', e);
  }
}
async function saveModConfig() {
  try {
    await fsPromises.writeFile(MOD_FILE, JSON.stringify({ evasionPatterns, autoPunish, welcomeEnabled, welcomeMessage, rankTemplate, authorizedUsers, authorizedEmails }, null, 2));
  } catch (e) {
    console.error('Failed to save mod config:', e);
  }
}

// In-memory logs for quick UI access
export interface LogEntry {
  timestamp: string;
  type: 'INFO' | 'ERROR' | 'MOD' | 'CHAT';
  message: string;
}
const logs: LogEntry[] = [];

export interface ChatMessage {
  id: string;
  timestamp: string;
  username: string;
  message: string;
  color?: string;
  badges?: Record<string, string>;
}
const chatMessages: ChatMessage[] = [];

async function loadChatHistory() {
  try {
    if (fs.existsSync(CHAT_FILE)) {
      const data = await fsPromises.readFile(CHAT_FILE, 'utf-8');
      const lines = data.trim().split('\n');
      for (const line of lines) {
        if (line) {
          chatMessages.push(JSON.parse(line));
        }
      }
      // Keep only last 100 in memory
      if (chatMessages.length > 100) {
        chatMessages.splice(0, chatMessages.length - 100);
      }
    }
  } catch (e) {
    console.error('Failed to load chat history:', e);
  }
}

async function addLog(message: string, type: 'INFO' | 'ERROR' | 'MOD' | 'CHAT' = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry: LogEntry = { timestamp, type, message };
  
  logs.unshift(logEntry);
  if (logs.length > 200) logs.pop(); // Keep last 200 in memory
  
  const logLine = `[${timestamp}] [${type}] ${message}\n`;
  console.log(logLine.trim());
  
  try {
    await fsPromises.appendFile(LOG_FILE, logLine);
  } catch (e) {
    console.error('Failed to write to log file:', e);
  }
}

// Bot state
let botClient: tmi.Client | null = null;
let botStatus = 'offline';
let reconnectTimer: NodeJS.Timeout | null = null;

// Bot Statistics State
let botStats = {
  totalMessages: 0,
  commandsProcessed: 0,
  commandUsage: {} as Record<string, number>,
  startTime: Date.now()
};

async function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const data = await fsPromises.readFile(STATS_FILE, 'utf-8');
      const saved = JSON.parse(data);
      botStats = { ...botStats, ...saved };
    }
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}
async function saveStats() {
  try {
    await fsPromises.writeFile(STATS_FILE, JSON.stringify(botStats, null, 2));
  } catch (e) {
    console.error('Failed to save stats:', e);
  }
}

// Custom Commands State
let customCommands: Record<string, string> = {
  '!hello': 'Hello there! I am your friendly LoL Twitch Bot.',
  '!discord': 'Join our community discord here: https://discord.gg/example',
  '!socials': 'Follow me on Twitter/X and Instagram @example!'
};

async function loadCustomCommands() {
  try {
    if (fs.existsSync(CUSTOM_CMDS_FILE)) {
      const data = await fsPromises.readFile(CUSTOM_CMDS_FILE, 'utf-8');
      customCommands = JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load custom commands:', e);
  }
}
async function saveCustomCommands() {
  try {
    await fsPromises.writeFile(CUSTOM_CMDS_FILE, JSON.stringify(customCommands, null, 2));
  } catch (e) {
    console.error('Failed to save custom commands:', e);
  }
}

// Cooldown System
const COOLDOWN_TIME = 10000; // 10 seconds per user per command
const GLOBAL_COOLDOWN = 3000; // 3 seconds global per command
const userCooldowns = new Map<string, number>();
const globalCooldowns = new Map<string, number>();

function checkCooldown(command: string, username: string): boolean {
  const now = Date.now();
  
  // Check global cooldown
  if (globalCooldowns.has(command)) {
    if (now < globalCooldowns.get(command)! + GLOBAL_COOLDOWN) return false;
  }
  
  // Check user cooldown
  const userKey = `${command}_${username}`;
  if (userCooldowns.has(userKey)) {
    if (now < userCooldowns.get(userKey)! + COOLDOWN_TIME) return false;
  }
  
  globalCooldowns.set(command, now);
  userCooldowns.set(userKey, now);
  return true;
}

/**
 * Robustly parses a message into arguments, supporting quoted strings.
 * Example: !command "arg with spaces" arg2 -> ["!command", "arg with spaces", "arg2"]
 */
function parseArgs(message: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < message.length; i++) {
    const char = message[i];

    if ((char === '"' || char === "'") && (i === 0 || message[i - 1] !== '\\')) {
      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else {
        inQuotes = true;
        quoteChar = char;
      }
    } else if (char === ' ' && !inQuotes) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

// Permission System
function isModOrBroadcaster(tags: tmi.ChatUserstate): boolean {
  const username = tags.username?.toLowerCase() || '';
  return tags.mod || tags.badges?.broadcaster === '1' || authorizedUsers.includes(username);
}

function isVIPModOrBroadcaster(tags: tmi.ChatUserstate): boolean {
  return isModOrBroadcaster(tags) || tags.badges?.vip === '1';
}

// Gemini AI Helper
function getGemini() {
  const apiKey = getCred('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  return new GoogleGenAI({ apiKey });
}

// Riot API Helper
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
        if (!isSilent) {
          addLog(`Riot API Error: Status ${status} - ${errorData.substring(0, 100)}`, (status === 404 || status === 403) ? 'INFO' : 'ERROR');
        } else if (status === 403) {
          // Even if silent, log 403 details to internal logs for debugging
          addLog(`Riot API 403 at ${url.split('.com')[1]}: ${errorData.substring(0, 50)}`, 'INFO');
        }
      }

      if (status === 429 && retries > 0) {
        const retryAfter = error.response.headers['retry-after'];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return riotRequest(url, apiKey, retries - 1, backoff * 2, silent404, silent403);
      }

      const err = new Error();
      (err as any).status = status;
      (err as any).code = code;

      if (status === 403) {
        err.message = "Forbidden";
        throw err;
      }
      if (status === 404) {
        err.message = "Not found.";
        throw err;
      }
    }
    
    // Handle DNS/Network errors
    if (code === 'ENOTFOUND') {
      const err = new Error(`DNS lookup failed: ${url}`);
      (err as any).code = 'ENOTFOUND';
      (err as any).status = 'DNS_ERROR';
      throw err;
    }

    // Handle other non-response errors (timeouts, network)
    if (retries > 0 && (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || !status)) {
      addLog(`Riot API Network Error (${code || 'unknown'}). Retrying...`, 'INFO');
      await new Promise(resolve => setTimeout(resolve, backoff));
      return riotRequest(url, apiKey, retries - 1, backoff * 2, silent404, silent403);
    }

    throw error;
  }
}

async function getRank(region: string, gameName: string, tagLine: string, formatType: 'all' | 'tft' | 'lol' = 'all') {
  const apiKey = getCred('RIOT_API_KEY');
  if (!apiKey) throw new Error("RIOT_API_KEY is not configured.");

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
  const defaultRegion = getCred('DEFAULT_RIOT_REGION') || 'na1';
  
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
  // Move initial routing to the front
  const routingsToTry = [initialRouting, ...routingRegions.filter(r => r !== initialRouting)];

  let puuid = '';
  let finalRouting = '';
  let hadValidResponse = false;
  let forbiddenRegions: string[] = [];

  // 1. Find PUUID by trying routing regions
  addLog(`Searching for PUUID: ${gameName}#${tagLine} across ${routingsToTry.join(', ')}`, 'INFO');
  for (const routing of routingsToTry) {
    try {
      const accountRes = await riotRequest(`https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, apiKey, 3, 1000, true, true);
      puuid = accountRes.data.puuid;
      finalRouting = routing;
      hadValidResponse = true;
      break;
    } catch (e: any) {
      if (e.status === 404) {
        hadValidResponse = true;
        continue;
      }
      if (e.status === 403) {
        forbiddenRegions.push(routing);
        continue;
      }
      throw e;
    }
  }

  if (!puuid) {
    if (forbiddenRegions.length > 0 && !hadValidResponse) {
      throw new Error(`Riot API Key is restricted or expired. (Forbidden in: ${forbiddenRegions.join(', ')}). Please check your key permissions in the Riot Developer Portal.`);
    }
    if (forbiddenRegions.length > 0) {
      throw new Error(`Player ${gameName}#${tagLine} not found in Americas, Europe, or Asia. (Note: Access to the ${forbiddenRegions.join(', ')} routing region was restricted by your API key)`);
    }
    throw new Error(`Player ${gameName}#${tagLine} not found in any Riot region. Double-check the Name#Tag.`);
  }

  // 2. Find Summoner ID by trying ALL platforms globally
  // Prioritize: 
  // 1. User's specified platform
  // 2. Other platforms in the same routing region
  // 3. All other platforms
  const allPlatforms = Object.values(regionMap).flatMap(r => r.platforms);
  const platformsToTry = [
    platform, 
    ...regionMap[finalRouting].platforms.filter(p => p !== platform),
    ...allPlatforms.filter(p => !regionMap[finalRouting].platforms.includes(p))
  ];

  addLog(`Found PUUID for ${gameName}#${tagLine} in ${finalRouting}. Scanning platforms for LoL/TFT ranks...`, 'INFO');

  let lolRank = 'Unranked';
  let tftRank = 'Unranked';
  let finalPlatform = '';
  let platformForbidden: string[] = [];

  for (const p of platformsToTry) {
    try {
      addLog(`Checking platform ${p} for ranks using PUUID...`, 'INFO');
      
      // 1. Try to get LoL League Entries by PUUID
      let lolEntries: any[] = [];
      let summonerData: any = null;
      try {
        const lolRes = await riotRequest(`https://${p}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`, apiKey, 2, 1000, true, true);
        lolEntries = lolRes.data;
        finalPlatform = p;
        
        // If we found entries, we can get summonerId from them
        // But if entries is empty (unranked), we still need the summonerId for TFT
        if (lolEntries.length === 0) {
          try {
            const sRes = await riotRequest(`https://${p}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`, apiKey, 1, 500, true, true);
            summonerData = sRes.data;
          } catch (se: any) {
            addLog(`Platform ${p}: Found in LoL but could not fetch summoner data.`, 'INFO');
          }
        }
      } catch (e: any) {
        if (e.status === 404) {
          addLog(`Platform ${p}: No LoL entries found by PUUID.`, 'INFO');
          // Check if they exist at all on this platform
          try {
            const sRes = await riotRequest(`https://${p}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`, apiKey, 1, 500, true, true);
            summonerData = sRes.data;
            finalPlatform = p;
          } catch (se: any) {
            if (se.status === 404) continue;
            throw se;
          }
        } else {
          throw e;
        }
      }

      if (finalPlatform) {
        addLog(`Account confirmed on platform: ${p}`, 'INFO');
        const soloQ = lolEntries.find((e: any) => e.queueType === 'RANKED_SOLO_5x5');
        lolRank = soloQ ? `${soloQ.tier} ${soloQ.rank}` : 'Unranked';

        // 2. Get TFT League Entries
        // Try PUUID first, then Summoner ID if we have it
        try {
          let tftEntries: any[] = [];
          let tftPuuidSuccess = false;
          let tftForbidden = false;
          try {
            const tftRes = await riotRequest(`https://${p}.api.riotgames.com/tft/league/v1/entries/by-puuid/${puuid}`, apiKey, 2, 1000, true, true);
            tftEntries = tftRes.data;
            tftPuuidSuccess = true;
          } catch (te: any) {
            const teStatus = te.status || (te.response ? te.response.status : 'unknown');
            if (teStatus === 403) tftForbidden = true;
            addLog(`Platform ${p}: TFT by PUUID failed (Status: ${teStatus}). Attempting fallback...`, 'INFO');
            
            // Fallback to by-summoner if we have the ID
            let sId = summonerData?.id || (lolEntries && lolEntries[0]?.summonerId);
            
            if (!sId) {
              try {
                addLog(`Platform ${p}: Fetching summoner ID via LoL endpoint...`, 'INFO');
                const sRes = await riotRequest(`https://${p}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`, apiKey, 1, 500, true, true);
                sId = sRes.data.id;
              } catch (se: any) {
                const seStatus = se.status || (se.response ? se.response.status : 'unknown');
                addLog(`Platform ${p}: LoL summoner endpoint failed (Status: ${seStatus}).`, 'INFO');
              }
            }

            // If still no ID, try to get it from TFT summoner endpoint
            if (!sId) {
              try {
                addLog(`Platform ${p}: Fetching summoner ID via TFT endpoint...`, 'INFO');
                const tftSummonerRes = await riotRequest(`https://${p}.api.riotgames.com/tft/summoner/v1/summoners/by-puuid/${puuid}`, apiKey, 1, 500, true, true);
                sId = tftSummonerRes.data.id;
                addLog(`Platform ${p}: Found summoner ID via TFT endpoint: ${sId}`, 'INFO');
              } catch (tse: any) {
                const tseStatus = tse.status || (tse.response ? tse.response.status : 'unknown');
                if (tseStatus === 403) tftForbidden = true;
                addLog(`Platform ${p}: TFT summoner endpoint failed (Status: ${tseStatus}).`, 'INFO');
              }
            }

            if (sId) {
              addLog(`Platform ${p}: Attempting TFT lookup by summoner ID...`, 'INFO');
              try {
                const tftRes = await riotRequest(`https://${p}.api.riotgames.com/tft/league/v1/entries/by-summoner/${sId}`, apiKey, 2, 1000, true, true);
                tftEntries = tftRes.data;
              } catch (tse: any) {
                const tseStatus = tse.status || (tse.response ? tse.response.status : 'unknown');
                if (tseStatus === 403) tftForbidden = true;
                addLog(`Platform ${p}: TFT lookup by summoner ID failed (Status: ${tseStatus}).`, 'INFO');
              }
            } else {
              addLog(`Platform ${p}: TFT lookup failed (PUUID Status: ${teStatus}) and no summoner ID could be retrieved.`, 'INFO');
            }
          }
          
          if (tftForbidden) {
            tftRank = 'API Restricted';
          } else {
            const tftSolo = tftEntries.find((e: any) => e.queueType === 'RANKED_TFT');
            if (tftSolo) {
              tftRank = `${tftSolo.tier} ${tftSolo.rank}`;
            }
          }
        } catch (e: any) {
          const eStatus = e.status || (e.response ? e.response.status : 'unknown');
          if (eStatus === 403) tftRank = 'API Restricted';
          await addLog(`Platform ${p}: TFT lookup failed (Status: ${eStatus}).`, 'INFO');
        }
        break;
      }
    } catch (e: any) {
      const status = e.status || (e.response ? e.response.status : 'unknown');
      const code = e.code || 'no-code';
      
      if (status === 404) {
        addLog(`Platform ${p}: Not found (404).`, 'INFO');
        continue;
      }
      if (status === 403 || status === 'Forbidden') {
        platformForbidden.push(p);
        addLog(`Platform ${p}: Access forbidden (403).`, 'INFO');
        continue;
      }
      if (status === 'DNS_ERROR' || code === 'ENOTFOUND') {
        addLog(`Platform ${p}: DNS lookup failed (ENOTFOUND). Skipping.`, 'INFO');
        continue;
      }
      addLog(`Platform ${p}: Error ${status} (${code})`, 'INFO');
      continue;
    }
  }

  if (!finalPlatform) {
    let msg = `Player ${gameName}#${tagLine} found, but no League of Legends or TFT account is linked to this Riot ID on any accessible region.`;
    if (platformForbidden.length > 0) {
      msg += ` (Note: Access to ${platformForbidden.join(', ')} was restricted by your API key)`;
    }
    throw new Error(msg);
  }

  if (formatType === 'tft') {
    return `${gameName}'s TFT Rank: ${tftRank}`;
  } else if (formatType === 'lol') {
    return `${gameName}'s LoL Rank: ${lolRank}`;
  }

  return rankTemplate
    .replace('{game_name}', gameName)
    .replace('{lol_rank}', lolRank)
    .replace('{tft_rank}', tftRank);
}

// Champion Data Cache
function initTwitch() {
  if (botStatus === 'online' || botStatus === 'connecting') return;

  // Cleanup old client if it exists
  if (botClient) {
    botClient.removeAllListeners();
    const state = botClient.readyState();
    if (state !== 'CLOSED' && state !== 'CLOSING') {
      botClient.disconnect().catch(() => {});
    }
    botClient = null;
  }

  const username = getCred('TWITCH_USERNAME');
  let password = getCred('TWITCH_OAUTH_TOKEN');
  const channel = getCred('TWITCH_CHANNEL');

  if (!username || !password || !channel) {
    botStatus = 'error: missing credentials';
    addLog('Failed to start: Missing TWITCH_USERNAME, TWITCH_OAUTH_TOKEN, or TWITCH_CHANNEL.', 'ERROR');
    return;
  }

  // Ensure password has oauth: prefix
  if (!password.startsWith('oauth:')) {
    password = `oauth:${password}`;
  }

  botStatus = 'connecting';
  botClient = new tmi.Client({
    options: { debug: false },
    identity: { username, password },
    channels: [channel]
  });

  botClient.connect().then(() => {
    if (botStatus === 'offline') {
      if (botClient?.readyState() !== 'CLOSED') {
        botClient?.disconnect().catch(() => {});
      }
      return;
    }
    botStatus = 'online';
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    addLog(`Connected to Twitch as ${username}, joined #${channel}`, 'INFO');
  }).catch(err => {
    if (botStatus === 'offline') return;
    
    const errMsg = err.message || String(err);
    const isAuthError = errMsg.includes('Login authentication failed');
    
    if (isAuthError) {
      botStatus = 'error: auth failed';
      addLog(`Twitch Authentication Failed: Your OAuth token is likely invalid or expired. Please generate a new one at https://twitchapps.com/tmi and update it in the Settings menu. Auto-reconnect disabled.`, 'ERROR');
      // Do not auto-reconnect on auth failure, requires manual credential update
    } else {
      botStatus = 'error';
      addLog(`Connection error: ${errMsg}`, 'ERROR');
      scheduleReconnect(10000);
    }
  });

  botClient.on('disconnected', (reason) => {
    if (botStatus === 'offline' || botStatus === 'error: auth failed') return; // Ignore if stopped manually or auth failed
    botStatus = 'disconnected';
    addLog(`Disconnected: ${reason || 'Unknown reason'}.`, 'ERROR');
    scheduleReconnect(10000);
  });

  function scheduleReconnect(delay = 10000) {
    if (botStatus === 'offline') return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    
    addLog(`Attempting to auto-reconnect in ${delay/1000} seconds...`, 'INFO');
    reconnectTimer = setTimeout(() => {
      if (botStatus !== 'online' && botStatus !== 'offline') {
        addLog('Auto-reconnecting...', 'INFO');
        initTwitch();
      }
    }, delay);
  }

  botClient.on('message', async (channel, tags, message, self) => {
    await handleChatMessage(channel, tags, message, self);
  });
}

function startBot() {
  initTwitch();
}

async function handleChatMessage(channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) {
    if (self) return; // Ignore messages from the bot itself

    const username = tags.username || 'unknown';

    // --- BAN EVASION & MODERATION SYSTEM ---
    try {
      const isEvading = evasionPatterns.some(pattern => {
        const regex = new RegExp(pattern, 'i');
        return regex.test(username);
      });

      if (isEvading) {
        addLog(`Ban evasion suspected for user: ${username}. Message ignored.`, 'MOD');
        
        if (autoPunish && botClient && botStatus === 'online') {
          botClient.whisper(username, "Warning: Your account has been flagged for ban evasion. Your messages are being ignored.")
            .catch(e => console.error(`Failed to whisper ${username}:`, e));
        }
        return; 
      }
    } catch (e: any) {
      addLog(`Regex error in evasion patterns: ${e.message}`, 'ERROR');
    }

    // --- WELCOME MESSAGE SYSTEM ---
    if (welcomeEnabled && !welcomedUsers.has(username)) {
      const welcomeText = welcomeMessage.replace('@user', `@${username}`);
      if (botClient && botStatus === 'online') {
        botClient.say(channel, welcomeText).catch(e => console.error('Failed to send welcome message:', e));
        welcomedUsers.add(username);
        saveWelcomedUsers();
        addLog(`Welcomed new user: ${username}`, 'INFO');
      }
    }

    if (message.startsWith('!')) {
      addLog(`Command: ${message} from @${username}`, 'CHAT');
    }

    // Add to chat messages
    botStats.totalMessages++;
    saveStats();

    const chatMsg: ChatMessage = {
      id: tags.id || Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      username: username,
      message: message,
      color: tags.color,
      badges: tags.badges as Record<string, string>
    };
    chatMessages.push(chatMsg);
    if (chatMessages.length > 100) chatMessages.shift(); // Keep last 100 in memory

    // Persist to file
    try {
      await fsPromises.appendFile(CHAT_FILE, JSON.stringify(chatMsg) + '\n');
    } catch (e) {
      console.error('Failed to persist chat message:', e);
    }

    const args = parseArgs(message);
    const command = args[0]?.toLowerCase() || '';

    const reply = (text: string) => {
      if (botClient && botStatus === 'online') {
        botClient.say(channel, text).catch(e => console.error('Failed to send message to Twitch:', e));
      }
    };

    // Check permissions for specific commands
    if (command === '!so' && !isModOrBroadcaster(tags)) {
      return;
    }

    // Check cooldowns (skip cooldowns for broadcasters/mods)
    if (['!rank', '!roast', '!analyze', '!ask', '!8ball', '!hug', ...Object.keys(customCommands)].includes(command)) {
      if (!isModOrBroadcaster(tags) && !checkCooldown(command, username)) {
        return; // Ignore if on cooldown
      }
    }

    // Track command usage
    botStats.commandsProcessed++;
    botStats.commandUsage[command] = (botStats.commandUsage[command] || 0) + 1;
    saveStats();

    try {
      // Handle Custom Commands first
      if (customCommands[command]) {
        reply(`@${username}, ${customCommands[command]}`);
        return;
      }

      if (command === '!rank') {
        // !rank [region] [Name#Tag] OR !rank [Name#Tag]
        let region = 'default';
        let riotId = '';

        const standardRegions = ['na1', 'euw1', 'eun1', 'tr1', 'jp1', 'br1', 'la1', 'la2', 'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2', 'me1', 'ru', 'pbe1', 'sea'];
        const shortRegions = ['na', 'euw', 'eune', 'tr', 'ru', 'kr', 'jp', 'br', 'lan', 'las', 'oc', 'oce', 'me', 'ph', 'sg', 'th', 'tw', 'vn', 'pbe', 'sea'];

        if (args.length >= 2) {
          const firstArg = args[1].toLowerCase();
          const rest = args.slice(2).join(' ');
          
          const isStandard = standardRegions.includes(firstArg);
          const isShort = shortRegions.includes(firstArg);

          // If first arg is a region AND the rest contains a #, it's [region] [Name#Tag]
          if ((isStandard || isShort) && rest.includes('#')) {
            region = firstArg;
            riotId = rest;
            addLog(`Parsed command: region=${region}, riotId=${riotId} (Split mode)`, 'INFO');
          } else {
            // Otherwise treat everything as the Riot ID
            riotId = args.slice(1).join(' ');
            addLog(`Parsed command: riotId=${riotId} (Global mode)`, 'INFO');
          }
        } else {
          reply(`@${username}, Usage: !rank [Name#Tag] or !rank [region] [Name#Tag]`);
          return;
        }

        if (!riotId || !riotId.includes('#')) {
          reply(`@${username}, Please include the tagline. Example: Faker#KR1`);
          return;
        }

        try {
          let [gameName, tagLine] = riotId.split('#');
          let rankInfo;
          try {
            rankInfo = await getRank(region, gameName, tagLine);
          } catch (e: any) {
            // If it failed and we were in "Split mode", try one more time treating the whole thing as the ID
            if (args.length >= 3 && e.message.includes('not found')) {
              const fullId = args.slice(1).join(' ');
              if (fullId.includes('#')) {
                const [fallbackName, fallbackTag] = fullId.split('#');
                addLog(`Initial search failed. Retrying with full ID: ${fallbackName}#${fallbackTag}`, 'INFO');
                // Use 'default' instead of hardcoded 'na1' to respect user settings
                rankInfo = await getRank('default', fallbackName, fallbackTag);
              } else {
                throw e;
              }
            } else {
              throw e;
            }
          }
          reply(`@${username}, ${rankInfo}`);
        } catch (error: any) {
          addLog(`Error handling command !rank: ${error.message}`, 'ERROR');
          reply(`@${username}, ${error.message}`);
        }

      } else if (command === '!setrank' && isModOrBroadcaster(tags)) {
        if (args.length < 2) {
          reply(`@${username}, Usage: !setrank [template]. Tags: {game_name}, {lol_rank}, {tft_rank}`);
          return;
        }
        rankTemplate = args.slice(1).join(' ');
        await saveModConfig();
        reply(`@${username}, Rank template updated!`);
      } else if (command === '!roast') {
        // !roast [region] [Name#Tag] OR !roast [Name#Tag]
        let region = 'default';
        let riotId = '';

        const standardRegions = ['na1', 'euw1', 'eun1', 'tr1', 'jp1', 'br1', 'la1', 'la2', 'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2', 'me1', 'ru', 'pbe1', 'sea'];
        const shortRegions = ['na', 'euw', 'eune', 'tr', 'ru', 'kr', 'jp', 'br', 'lan', 'las', 'oc', 'oce', 'me', 'ph', 'sg', 'th', 'tw', 'vn', 'pbe', 'sea'];

        if (args.length >= 2) {
          const firstArg = args[1].toLowerCase();
          const rest = args.slice(2).join(' ');
          
          const isStandard = standardRegions.includes(firstArg);
          const isShort = shortRegions.includes(firstArg);

          if ((isStandard || isShort) && rest.includes('#')) {
            region = firstArg;
            riotId = rest;
          } else {
            riotId = args.slice(1).join(' ');
          }
        } else {
          reply(`@${username}, Usage: !roast [Name#Tag] or !roast [region] [Name#Tag]`);
          return;
        }

        if (!riotId || !riotId.includes('#')) {
          reply(`@${username}, Please include the tagline. Example: Faker#KR1`);
          return;
        }

        try {
          let [gameName, tagLine] = riotId.split('#');
          let rankInfo;
          try {
            rankInfo = await getRank(region, gameName, tagLine);
          } catch (e: any) {
            if (args.length >= 3 && e.message.includes('not found')) {
              const fullId = args.slice(1).join(' ');
              if (fullId.includes('#')) {
                const [fallbackName, fallbackTag] = fullId.split('#');
                addLog(`Initial search failed. Retrying with full ID: ${fallbackName}#${fallbackTag}`, 'INFO');
                rankInfo = await getRank('na1', fallbackName, fallbackTag);
              } else {
                throw e;
              }
            } else {
              throw e;
            }
          }

          const ai = getGemini();
          const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: `Roast this League of Legends player based on their rank: "${rankInfo}". Keep it under 2 sentences, funny, slightly sassy, and Twitch TOS safe. Do not use markdown.`,
          });
          reply(`@${username}, ${response.text}`);
        } catch (error: any) {
          const errMsg = typeof error?.message === 'string' ? error.message : String(error);
          addLog(`Error in !roast: ${errMsg}`, 'ERROR');
          const isQuotaError = errMsg.includes('429') || errMsg.includes('quota') || error?.status === 429;
          const isInvalidKey = errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID');
          
          if (isInvalidKey) {
            reply(`@${username}, My AI brain is offline because the Gemini API key is invalid. Please check the dashboard settings!`);
          } else if (isQuotaError) {
            reply(`@${username}, Gemini AI is currently at its limit. Please try again in a minute!`);
          } else if (errMsg.includes('not found')) {
            reply(`@${username}, ${errMsg}`);
          } else if (error?.status === 429 || error?.response?.status === 429) {
            reply(`@${username}, Riot API is rate limiting me. Too many requests!`);
          } else {
            const msg = errMsg.includes('not found') ? errMsg : "Couldn't roast them right now. Maybe they're already burnt.";
            reply(`@${username}, ${msg}`);
          }
        }

      } else if (command === '!ask') {
        if (!isVIPModOrBroadcaster(tags)) return;
        const question = args.slice(1).join(' ');
        if (!question) {
          reply(`@${username}, What do you want to ask? Example: !ask What is the best build for Teemo?`);
          return;
        }
        try {
          const ai = getGemini();
          const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: question,
            config: {
              systemInstruction: "You are a witty, slightly sarcastic League of Legends Twitch chat bot. Keep your answers under 2 sentences and under 400 characters. Do not use markdown formatting like bold or italics, as Twitch chat doesn't support it well.",
            }
          });
          reply(`@${username}, ${response.text}`);
        } catch (error: any) {
          const errMsg = typeof error?.message === 'string' ? error.message : String(error);
          addLog(`Error in !ask: ${errMsg}`, 'ERROR');
          const isQuotaError = errMsg.includes('429') || errMsg.includes('quota') || error?.status === 429;
          const isInvalidKey = errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID');

          if (isInvalidKey) {
            reply(`@${username}, My AI brain is offline because the Gemini API key is invalid. Please check the dashboard settings!`);
          } else if (isQuotaError) {
            reply(`@${username}, Gemini AI is currently at its limit. Please try again in a minute!`);
          } else {
            reply(`@${username}, My AI brain is currently on cooldown or blocked the prompt.`);
          }
        }

      } else if (extraCommandsInstalled && command === '!8ball') {
        const answers = ['It is certain.', 'Without a doubt.', 'You may rely on it.', 'Yes, definitely.', 'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.', 'My sources say no.', 'Outlook not so good.', 'Very doubtful.'];
        const answer = answers[Math.floor(Math.random() * answers.length)];
        reply(`@${username}, 🎱 ${answer}`);
      } else if (extraCommandsInstalled && command === '!hug') {
        const target = args.length > 1 ? args[1].replace('@', '') : 'themselves';
        reply(`@${username} gives a big warm hug to @${target}! 🫂`);
      }
    } catch (error: any) {
      addLog(`Error handling command ${command}: ${error.message}`, 'ERROR');
      reply(`@${username}, ${error.message || 'Error fetching data.'}`);
    }
}

// API Routes
app.get('/api/status', (req, res) => {
  const uptimeSeconds = process.uptime();
  const d = Math.floor(uptimeSeconds / (3600*24));
  const h = Math.floor(uptimeSeconds % (3600*24) / 3600);
  const m = Math.floor(uptimeSeconds % 3600 / 60);
  const s = Math.floor(uptimeSeconds % 60);
  const pad = (num: number) => num.toString().padStart(2, '0');
  const uptime = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;

  res.json({
    status: botStatus,
    uptime: uptime,
    config: {
      hasTwitchUser: !!getCred('TWITCH_USERNAME'),
      hasTwitchToken: !!getCred('TWITCH_OAUTH_TOKEN'),
      hasTwitchChannel: !!getCred('TWITCH_CHANNEL'),
      hasRiotKey: !!getCred('RIOT_API_KEY'),
      hasGeminiKey: !!getCred('GEMINI_API_KEY'),
      hasAdminPassword: !!getCred('ADMIN_PASSWORD'),
      DEFAULT_RIOT_REGION: getCred('DEFAULT_RIOT_REGION') || 'na1'
    },
    stats: botStats
  });
});

app.post('/api/auth/login', (req, res) => {
  const { password, email } = req.body;
  const adminPassword = getCred('ADMIN_PASSWORD');
  const ownerEmail = 'fireskyer@gmail.com';
  
  // 1. Check if email is authorized
  const cleanEmail = email?.toLowerCase().trim();
  const isAuthorizedEmail = cleanEmail === ownerEmail || authorizedEmails.includes(cleanEmail);

  if (!isAuthorizedEmail) {
    addLog(`Unauthorized login attempt from: ${email}`, 'MOD');
    return res.status(403).json({ error: 'Your email is not authorized to access this dashboard.' });
  }

  // 2. Check password
  if (!adminPassword) {
    addLog(`Operator ${email} logged in (No password configured)`, 'INFO');
    if (botClient && botStatus === 'online') {
      const channel = getCred('TWITCH_CHANNEL');
      if (channel) botClient.say(channel, `[System] Operator ${email.split('@')[0]} has established an uplink to the Command Center.`).catch(() => {});
    }
    return res.json({ success: true, message: 'No admin password configured. Access granted.' });
  }

  if (password === adminPassword) {
    addLog(`Operator ${email} successfully logged in`, 'INFO');
    if (botClient && botStatus === 'online') {
      const channel = getCred('TWITCH_CHANNEL');
      if (channel) botClient.say(channel, `[System] Operator ${email.split('@')[0]} has established an uplink to the Command Center.`).catch(() => {});
    }
    res.json({ success: true });
  } else {
    addLog(`Failed login attempt for ${email}`, 'MOD');
    res.status(401).json({ error: 'Invalid Authorization Key' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  addLog('Admin logged out', 'INFO');
  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  res.json(botStats);
});

app.get('/api/commands/custom', (req, res) => {
  res.json(customCommands);
});

app.post('/api/commands/custom', async (req, res) => {
  const { command, response } = req.body;
  if (!command || !response) return res.status(400).json({ error: 'Command and response required' });
  if (!command.startsWith('!')) return res.status(400).json({ error: 'Command must start with !' });
  
  customCommands[command] = response;
  await saveCustomCommands();
  addLog(`Added custom command: ${command}`, 'INFO');
  res.json({ success: true, commands: customCommands });
});

app.delete('/api/commands/custom/:command', async (req, res) => {
  const cmdToDelete = Buffer.from(req.params.command, 'base64').toString('utf-8');
  if (customCommands[cmdToDelete]) {
    delete customCommands[cmdToDelete];
    await saveCustomCommands();
    addLog(`Deleted custom command: ${cmdToDelete}`, 'INFO');
    res.json({ success: true, commands: customCommands });
  } else {
    res.status(404).json({ error: 'Command not found' });
  }
});

app.post('/api/credentials', async (req, res) => {
  const { TWITCH_USERNAME, TWITCH_OAUTH_TOKEN, TWITCH_CHANNEL, RIOT_API_KEY, GEMINI_API_KEY, ADMIN_PASSWORD, DEFAULT_RIOT_REGION } = req.body;
  if (TWITCH_USERNAME !== undefined) customCreds.TWITCH_USERNAME = TWITCH_USERNAME.trim();
  if (TWITCH_OAUTH_TOKEN !== undefined) customCreds.TWITCH_OAUTH_TOKEN = TWITCH_OAUTH_TOKEN.trim();
  if (TWITCH_CHANNEL !== undefined) customCreds.TWITCH_CHANNEL = TWITCH_CHANNEL.trim();
  if (RIOT_API_KEY !== undefined) customCreds.RIOT_API_KEY = RIOT_API_KEY.trim();
  if (GEMINI_API_KEY !== undefined) customCreds.GEMINI_API_KEY = GEMINI_API_KEY.trim();
  if (ADMIN_PASSWORD !== undefined) customCreds.ADMIN_PASSWORD = ADMIN_PASSWORD.trim();
  if (DEFAULT_RIOT_REGION !== undefined) customCreds.DEFAULT_RIOT_REGION = DEFAULT_RIOT_REGION.trim();

  try {
    await fsPromises.writeFile(CRED_FILE, JSON.stringify(customCreds, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to save credentials:', e);
    res.status(500).json({ error: 'Failed to save credentials' });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({ logs });
});

app.get('/api/system/diagnostic', async (req, res) => {
  const diagnostic: any = {
    timestamp: new Date().toISOString(),
    checks: []
  };

  // 1. Check Credentials
  const required = ['TWITCH_USERNAME', 'TWITCH_OAUTH_TOKEN', 'TWITCH_CHANNEL'];
  const missing = required.filter(key => !getCred(key));
  diagnostic.checks.push({
    name: 'Core Credentials',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    message: missing.length === 0 ? 'All core credentials present.' : `Missing: ${missing.join(', ')}`
  });

  // 2. Check File System
  try {
    const testFile = path.join(process.cwd(), '.write_test');
    await fsPromises.writeFile(testFile, 'test');
    await fsPromises.unlink(testFile);
    diagnostic.checks.push({ name: 'File System', status: 'PASS', message: 'Read/Write access verified.' });
  } catch (e: any) {
    diagnostic.checks.push({ name: 'File System', status: 'FAIL', message: `Write error: ${e.message}` });
  }

  // 3. Check Riot API
  const riotKey = getCred('RIOT_API_KEY');
  if (riotKey) {
    try {
      const routings = ['americas', 'europe', 'asia', 'sea'];
      const results = await Promise.all(routings.map(async r => {
        try {
          await axios.get(`https://${r}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Test/1234`, {
            headers: { 'X-Riot-Token': riotKey }
          });
          return { region: r, status: 'OK' };
        } catch (e: any) {
          return { region: r, status: e.response?.status || 'ERROR' };
        }
      }));
      
      const forbidden = results.filter(r => r.status === 403).map(r => r.region);
      const ok = results.filter(r => r.status === 404 || r.status === 'OK');
      
      if (ok.length > 0) {
        let msg = 'API Key is valid.';
        if (forbidden.length > 0) {
          msg += ` (Restricted in: ${forbidden.join(', ')}). To fix this, ensure your Riot API key has access to these regions in the Riot Developer Portal.`;
        }
        diagnostic.checks.push({ name: 'Riot API (LoL)', status: forbidden.length > 0 ? 'WARN' : 'PASS', message: msg });

        // Check TFT specifically
        try {
          const tftResults = await Promise.all(routings.map(async r => {
            try {
              // Try a generic TFT endpoint
              await axios.get(`https://${r}.api.riotgames.com/tft/league/v1/challenger`, {
                headers: { 'X-Riot-Token': riotKey }
              });
              return { region: r, status: 'OK' };
            } catch (e: any) {
              return { region: r, status: e.response?.status || 'ERROR' };
            }
          }));
          const tftForbidden = tftResults.filter(r => r.status === 403).map(r => r.region);
          if (tftForbidden.length > 0) {
            diagnostic.checks.push({ 
              name: 'Riot API (TFT)', 
              status: 'WARN', 
              message: `TFT access restricted in: ${tftForbidden.join(', ')}. Ensure your key has TFT permissions.` 
            });
          } else {
            diagnostic.checks.push({ name: 'Riot API (TFT)', status: 'PASS', message: 'TFT API access verified.' });
          }
        } catch (e) {
          // Ignore TFT diagnostic errors
        }
      } else {
        diagnostic.checks.push({ name: 'Riot API', status: 'FAIL', message: 'API Key is invalid or expired in all regions.' });
      }
    } catch (e: any) {
      diagnostic.checks.push({ name: 'Riot API', status: 'FAIL', message: `API Error: ${e.message}` });
    }
  } else {
    diagnostic.checks.push({ name: 'Riot API', status: 'WARN', message: 'Riot API Key not configured.' });
  }

  // 4. Check Gemini API
  const geminiKey = getCred('GEMINI_API_KEY');
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      // Using gemini-3.1-pro-preview
      await (ai as any).models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: 'test'
      });
      diagnostic.checks.push({ name: 'Gemini AI', status: 'PASS', message: 'API Key is valid (using 3.1-pro-preview).' });
    } catch (e: any) {
      diagnostic.checks.push({ name: 'Gemini AI', status: 'FAIL', message: `API Error: ${e.message}` });
    }
  } else {
    diagnostic.checks.push({ name: 'Gemini AI', status: 'WARN', message: 'Gemini API Key not configured.' });
  }

  res.json(diagnostic);
});

app.post('/api/system/repair', async (req, res) => {
  const actions: string[] = [];
  
  try {
    // 1. Clear corrupted state files if they are empty or invalid
    const files = [MOD_FILE, CRED_FILE, STATS_FILE, CUSTOM_CMDS_FILE];
    for (const file of files) {
      if (fs.existsSync(file)) {
        try {
          const content = await fsPromises.readFile(file, 'utf-8');
          JSON.parse(content);
        } catch (e) {
          actions.push(`Repaired corrupted file: ${path.basename(file)}`);
          await fsPromises.writeFile(file, '{}');
        }
      }
    }

    // 2. Reset Cooldowns
    userCooldowns.clear();
    globalCooldowns.clear();
    actions.push('Reset command cooldowns.');

    // 3. Restart Bot if in error state
    if (botStatus.startsWith('error')) {
      actions.push('Attempting bot restart...');
      startBot();
    }

    addLog(`System Repair executed: ${actions.join(', ')}`, 'INFO');
    res.json({ success: true, actions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chat', (req, res) => {
  res.json({ messages: chatMessages });
});

app.post('/api/chat/send', (req, res) => {
  const { message } = req.body;
  const channel = getCred('TWITCH_CHANNEL');
  
  if (!message) return res.status(400).json({ error: 'Message required' });
  if (!botClient || botStatus !== 'online') {
    return res.status(503).json({ error: 'Bot is offline' });
  }

  try {
    botClient.say(channel, message);
    
    // Add to local chat feed
    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      username: getCred('TWITCH_USERNAME') || 'Bot',
      message: message,
      color: '#c89b3c' // Bot gold color
    };
    chatMessages.push(chatMsg);
    if (chatMessages.length > 100) chatMessages.shift();
    
    addLog(`Dashboard Message: ${message}`, 'CHAT');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function executeTwitchModAction(action: 'timeout' | 'ban' | 'delete', channelName: string, targetUsername?: string, messageId?: string, duration?: number, reason?: string) {
  let token = getCred('TWITCH_OAUTH_TOKEN');
  if (!token) throw new Error("No Twitch token configured");
  if (token.startsWith('oauth:')) token = token.slice(6);

  // 1. Validate token to get client_id and bot's user_id
  const valRes = await axios.get('https://id.twitch.tv/oauth2/validate', {
    headers: { 'Authorization': `OAuth ${token}` }
  });
  const clientId = valRes.data.client_id;
  const botUserId = valRes.data.user_id;

  // 2. Get broadcaster ID and target user ID
  const usersToFetch = [channelName.replace('#', '')];
  if (targetUsername) usersToFetch.push(targetUsername);

  const usersRes = await axios.get(`https://api.twitch.tv/helix/users?login=${usersToFetch.join('&login=')}`, {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${token}`
    }
  });

  const broadcaster = usersRes.data.data.find((u: any) => u.login.toLowerCase() === channelName.replace('#', '').toLowerCase());
  if (!broadcaster) throw new Error("Could not find broadcaster ID");
  const broadcasterId = broadcaster.id;

  let targetUserId = '';
  if (targetUsername) {
    const target = usersRes.data.data.find((u: any) => u.login.toLowerCase() === targetUsername.toLowerCase());
    if (!target) throw new Error("Could not find target user ID");
    targetUserId = target.id;
  }

  // 3. Execute action
  if (action === 'timeout' || action === 'ban') {
    await axios.post(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${botUserId}`, {
      data: {
        user_id: targetUserId,
        duration: action === 'timeout' ? duration : undefined,
        reason: reason
      }
    }, {
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  } else if (action === 'delete') {
    await axios.delete(`https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${botUserId}&message_id=${messageId}`, {
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${token}`
      }
    });
  }
}

app.post('/api/chat/action', async (req, res) => {
  const { action, username, messageId, duration = 600, reason = 'Moderator action via Dashboard' } = req.body;
  const channel = getCred('TWITCH_CHANNEL');
  
  if (!botClient || botStatus !== 'online') {
    return res.status(503).json({ error: 'Bot is offline' });
  }

  try {
    if (action === 'timeout' && username) {
      await executeTwitchModAction('timeout', channel, username, undefined, duration, reason);
      addLog(`Timed out ${username} for ${duration}s: ${reason}`, 'MOD');
    } else if (action === 'ban' && username) {
      await executeTwitchModAction('ban', channel, username, undefined, undefined, reason);
      addLog(`Banned ${username}: ${reason}`, 'MOD');
    } else if (action === 'delete' && messageId) {
      await executeTwitchModAction('delete', channel, undefined, messageId);
      addLog(`Deleted message ${messageId}`, 'MOD');
    } else {
      return res.status(400).json({ error: 'Invalid action or missing parameters' });
    }
    res.json({ success: true });
  } catch (e: any) {
    const errorMsg = e?.response?.data?.message || e?.message || String(e);
    addLog(`Mod action failed: ${errorMsg}`, 'ERROR');
    res.status(500).json({ error: errorMsg });
  }
});

app.get('/api/system/updates', async (req, res) => {
  try {
    let stdout = '';
    try {
      const result = await execAsync('npx npm outdated --json');
      stdout = result.stdout;
    } catch (e: any) {
      // npm outdated exits with code 1 if there are outdated packages
      stdout = e.stdout || '{}';
    }
    const parsed = JSON.parse(stdout || '{}');
    res.json({ updates: parsed });
  } catch (error) {
    console.error('Failed to check updates:', error);
    res.status(500).json({ error: 'Failed to check for updates' });
  }
});

// Admin Panel Routes
app.get('/api/mod/patterns', (req, res) => {
  res.json({ patterns: evasionPatterns, autoPunish });
});

app.post('/api/mod/patterns', async (req, res) => {
  const { pattern } = req.body;
  if (!pattern) return res.status(400).json({ error: 'Pattern required' });
  
  try {
    new RegExp(pattern);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid Regular Expression' });
  }

  if (!evasionPatterns.includes(pattern)) {
    evasionPatterns.push(pattern);
    await saveModConfig();
    addLog(`Added new ban evasion pattern: ${pattern}`, 'MOD');
  }
  res.json({ success: true, patterns: evasionPatterns, autoPunish });
});

app.post('/api/mod/autopunish', async (req, res) => {
  const { enabled } = req.body;
  autoPunish = !!enabled;
  await saveModConfig();
  addLog(`Ban evasion auto-punish ${autoPunish ? 'enabled' : 'disabled'}`, 'MOD');
  res.json({ success: true, autoPunish });
});

app.get('/api/mod/welcome', (req, res) => {
  res.json({ enabled: welcomeEnabled, message: welcomeMessage });
});

app.post('/api/mod/welcome', async (req, res) => {
  const { enabled, message } = req.body;
  if (enabled !== undefined) welcomeEnabled = !!enabled;
  if (message !== undefined) welcomeMessage = message;
  await saveModConfig();
  addLog(`Welcome message ${welcomeEnabled ? 'enabled' : 'disabled'}`, 'INFO');
  res.json({ success: true, enabled: welcomeEnabled, message: welcomeMessage });
});

app.get('/api/mod/rank', (req, res) => {
  res.json({ template: rankTemplate });
});

app.post('/api/mod/rank', async (req, res) => {
  const { template } = req.body;
  if (template !== undefined) rankTemplate = template;
  await saveModConfig();
  addLog(`Updated rank message template`, 'INFO');
  res.json({ success: true, template: rankTemplate });
});

app.delete('/api/mod/patterns/:pattern', async (req, res) => {
  const patternToDelete = Buffer.from(req.params.pattern, 'base64').toString('utf-8');
  evasionPatterns = evasionPatterns.filter(p => p !== patternToDelete);
  await saveModConfig();
  addLog(`Removed ban evasion pattern: ${patternToDelete}`, 'MOD');
  res.json({ success: true, patterns: evasionPatterns });
});

app.get('/api/mod/authorized', (req, res) => {
  res.json({ users: authorizedUsers });
});

app.post('/api/mod/authorized', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  
  const cleanUser = username.toLowerCase().replace('@', '').trim();
  if (!authorizedUsers.includes(cleanUser)) {
    authorizedUsers.push(cleanUser);
    await saveModConfig();
    addLog(`Registered authorized operator: ${cleanUser}`, 'MOD');
  }
  res.json({ success: true, users: authorizedUsers });
});

app.delete('/api/mod/authorized/:username', async (req, res) => {
  const userToDelete = req.params.username.toLowerCase();
  authorizedUsers = authorizedUsers.filter(u => u !== userToDelete);
  await saveModConfig();
  addLog(`Revoked access for operator: ${userToDelete}`, 'MOD');
  res.json({ success: true, users: authorizedUsers });
});

app.get('/api/mod/emails', (req, res) => {
  res.json({ emails: authorizedEmails });
});

app.post('/api/mod/emails', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  const cleanEmail = email.toLowerCase().trim();
  if (!authorizedEmails.includes(cleanEmail)) {
    authorizedEmails.push(cleanEmail);
    await saveModConfig();
    addLog(`Registered authorized dashboard operator: ${cleanEmail}`, 'MOD');
  }
  res.json({ success: true, emails: authorizedEmails });
});

app.delete('/api/mod/emails/:email', async (req, res) => {
  const emailToDelete = req.params.email.toLowerCase();
  authorizedEmails = authorizedEmails.filter(e => e !== emailToDelete);
  await saveModConfig();
  addLog(`Revoked dashboard access for: ${emailToDelete}`, 'MOD');
  res.json({ success: true, emails: authorizedEmails });
});

app.post('/api/start', (req, res) => {
  startBot();
  res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  botStatus = 'offline';
  if (botClient) {
    botClient.removeAllListeners();
    botClient.disconnect().catch(() => {});
    botClient = null;
  }
  addLog('Bot stopped manually.', 'INFO');
  res.json({ success: true });
});

// Start bot automatically if credentials exist
// This is now handled in initBot()

app.get('/api/mod/commands/check', (req, res) => {
  if (extraCommandsInstalled) {
    res.json({ available: [] });
  } else {
    res.json({
      available: [
        { name: '!8ball', description: 'Ask the magic 8-ball a question' },
        { name: '!lurk', description: 'Announce you are lurking' },
        { name: '!hug', description: 'Give someone a virtual hug' }
      ]
    });
  }
});

app.post('/api/mod/commands/install', (req, res) => {
  extraCommandsInstalled = true;
  res.json({ success: true });
});

// Vite middleware
async function startServer() {
  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    
    // Serve from dist
    app.use(express.static(distPath));
    
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
