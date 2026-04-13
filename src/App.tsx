/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Bot, Settings, Terminal, CheckCircle, XCircle, Play, Square, RefreshCw, Shield, LayoutDashboard, FileText, Trash2, Plus, Save, MessageSquare, Activity, Zap, Lock, LogOut, User as UserIcon, Send, BookOpen, ExternalLink, Info, ShieldCheck, Wrench, Search, AlertTriangle, ArrowRight, Key, Globe, Cpu, UserPlus, Ban, Clock, Link as LinkIcon } from 'lucide-react';
import { FaTwitch } from 'react-icons/fa';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { auth, googleProvider, signInWithPopup, onAuthStateChanged, User, db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, query, orderBy, limit, handleFirestoreError, OperationType, addDoc } from './firebase';

interface BotStatus {
  status: string;
  config: {
    hasTwitchUser: boolean;
    hasTwitchToken: boolean;
    hasTwitchChannel: boolean;
    hasRiotKey: boolean;
    hasGeminiKey: boolean;
    hasAdminPassword: boolean;
    DEFAULT_RIOT_REGION: string;
  };
  stats: {
    totalMessages: number;
    commandsProcessed: number;
    commandUsage: Record<string, number>;
    startTime: number;
  };
  uptime?: string;
}

interface LogEntry {
  timestamp: string;
  type: 'INFO' | 'ERROR' | 'MOD' | 'CHAT';
  message: string;
}

interface OutdatedPackage {
  current: string;
  wanted: string;
  latest: string;
}

interface ChatMessage {
  id: string;
  timestamp: string;
  username: string;
  message: string;
  color?: string;
  badges?: Record<string, string>;
}

const TwitchIcon = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="24" 
    height="24" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7"/>
  </svg>
);

const ConfigItem = ({ label, isSet }: { label: string, isSet: boolean }) => (
  <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-hextech-gold/10 group hover:border-hextech-gold/30 transition-all duration-500 relative overflow-hidden">
    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-transparent via-hextech-gold/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    <div className="flex flex-col relative z-10">
      <span className="text-slate-500 text-[9px] uppercase font-black tracking-[0.2em] mb-1 group-hover:text-hextech-gold transition-colors">Registry Key</span>
      <span className="text-slate-200 font-mono text-[11px] font-bold tracking-tight">{label}</span>
    </div>
    <div className="relative z-10">
      {isSet ? (
        <div className="flex items-center text-hextech-cyan text-[9px] font-black tracking-[0.2em] uppercase bg-hextech-cyan/5 px-3 py-1.5 rounded-lg border border-hextech-cyan/20 magic-glow shadow-[0_0_15px_rgba(0,255,255,0.05)]">
          <Zap className="w-3 h-3 mr-2 animate-pulse" /> Linked
        </div>
      ) : (
        <div className="flex items-center text-rose-500 text-[9px] font-black tracking-[0.2em] uppercase bg-rose-500/5 px-3 py-1.5 rounded-lg border border-rose-500/20">
          <XCircle className="w-3 h-3 mr-2" /> Null
        </div>
      )}
    </div>
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'mod' | 'settings' | 'commands' | 'chat'>('dashboard');
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [autoPunish, setAutoPunish] = useState(false);
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [rankTemplate, setRankTemplate] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [authorizedUsers, setAuthorizedUsers] = useState<string[]>([]);
  const [newAuthorizedUser, setNewAuthorizedUser] = useState('');
  const [authorizedEmails, setAuthorizedEmails] = useState<string[]>([]);
  const [newAuthorizedEmail, setNewAuthorizedEmail] = useState('');
  const [accessRequests, setAccessRequests] = useState<any[]>([]);
  const [customCommands, setCustomCommands] = useState<Record<string, string>>({});
  const [newCmd, setNewCmd] = useState({ command: '', response: '' });
  const [loading, setLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<string>('ALL');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [adminPass, setAdminPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [regData, setRegData] = useState({ twitch: '', email: '', authCode: '' });
  const [regSuccess, setRegSuccess] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Settings State
  const [creds, setCreds] = useState({
    TWITCH_USERNAME: '',
    TWITCH_OAUTH_TOKEN: '',
    TWITCH_CHANNEL: '',
    RIOT_API_KEY: '',
    GEMINI_API_KEY: '',
    ADMIN_PASSWORD: '',
    DEFAULT_RIOT_REGION: 'na1'
  });
  const [saveStatus, setSaveStatus] = useState('');

  // Updates State
  const [updates, setUpdates] = useState<Record<string, OutdatedPackage> | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  
  // System Health State
  const [diagnostic, setDiagnostic] = useState<{ timestamp: string, checks: any[] } | null>(null);
  const [runningDiagnostic, setRunningDiagnostic] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResults, setRepairResults] = useState<string[] | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [localUptime, setLocalUptime] = useState<string>('00:00:00');

  useEffect(() => {
    if (!botStatus?.stats?.startTime) return;
    
    const interval = setInterval(() => {
      const uptimeSeconds = Math.floor((Date.now() - botStatus.stats.startTime) / 1000);
      const d = Math.floor(uptimeSeconds / (3600*24));
      const h = Math.floor(uptimeSeconds % (3600*24) / 3600);
      const m = Math.floor(uptimeSeconds % 3600 / 60);
      const s = Math.floor(uptimeSeconds % 60);
      const pad = (num: number) => num.toString().padStart(2, '0');
      const uptimeStr = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
      setLocalUptime(uptimeStr);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [botStatus?.stats?.startTime]);

  const handleRunDiagnostic = async () => {
    setRunningDiagnostic(true);
    setRepairResults(null);
    try {
      const res = await fetch('/api/system/diagnostic');
      const data = await res.json();
      setDiagnostic(data);
    } catch (e) {
      console.error(e);
    }
    setRunningDiagnostic(false);
  };

  const handleRunRepair = async () => {
    setRepairing(true);
    try {
      const res = await fetch('/api/system/repair', { method: 'POST' });
      const data = await res.json();
      setRepairResults(data.actions || []);
      // Re-run diagnostic after repair
      await handleRunDiagnostic();
    } catch (e) {
      console.error(e);
    }
    setRepairing(false);
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await fetch('/api/system/updates');
      const data = await res.json();
      setUpdates(data.updates || {});
    } catch (e) {
      console.error(e);
    }
    setCheckingUpdates(false);
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setBotStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLogs(data.logs);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchChat = async () => {
    try {
      const res = await fetch('/api/chat');
      const data = await res.json();
      setChatMessages(prev => {
        // Only update if the messages have actually changed to prevent unnecessary re-renders
        if (prev.length === data.messages.length && 
            prev.length > 0 && 
            prev[prev.length - 1].id === data.messages[data.messages.length - 1].id) {
          return prev;
        }
        return data.messages;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPatterns = async () => {
    try {
      const res = await fetch('/api/mod/patterns');
      const data = await res.json();
      setPatterns(data.patterns);
      setAutoPunish(data.autoPunish);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAuthorizedUsers = async () => {
    try {
      const res = await fetch('/api/mod/authorized');
      const data = await res.json();
      setAuthorizedUsers(data.users);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAuthorizedEmails = async () => {
    try {
      const res = await fetch('/api/mod/emails');
      const data = await res.json();
      setAuthorizedEmails(data.emails);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCustomCommands = async () => {
    try {
      const res = await fetch('/api/commands/custom');
      const data = await res.json();
      setCustomCommands(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWelcomeSettings = async () => {
    try {
      const res = await fetch('/api/mod/welcome');
      const data = await res.json();
      setWelcomeEnabled(data.enabled);
      setWelcomeMessage(data.message);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRankTemplate = async () => {
    try {
      const res = await fetch('/api/mod/rank');
      const data = await res.json();
      setRankTemplate(data.template);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register') {
      setAuthMode('register');
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      // We let the server handle specific email authorization during handleLogin
      const localAuth = localStorage.getItem('bot_admin_auth') === 'true';
      setIsLoggedIn(localAuth && !!currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    fetchChat();
    fetchPatterns();
    fetchAuthorizedUsers();
    fetchAuthorizedEmails();
    fetchCustomCommands();
    fetchWelcomeSettings();
    fetchRankTemplate();
    const interval = setInterval(() => {
      fetchStatus();
      if (activeTab === 'logs' || activeTab === 'dashboard') {
        fetchLogs();
      }
      if (activeTab === 'dashboard') {
        fetchChat();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    if (botStatus?.config.DEFAULT_RIOT_REGION) {
      setCreds(prev => ({ ...prev, DEFAULT_RIOT_REGION: botStatus.config.DEFAULT_RIOT_REGION }));
    }
  }, [botStatus?.config.DEFAULT_RIOT_REGION]);

  useEffect(() => {
    if (!isLoggedIn) return;
    
    const q = query(collection(db, 'access_requests'), orderBy('timestamp', 'desc'));
    const unsubscribeRequests = onSnapshot(q, (snapshot) => {
      const reqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAccessRequests(reqs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'access_requests');
    });

    return () => unsubscribeRequests();
  }, [isLoggedIn]);

  const handleStart = async () => {
    setLoading(true);
    await fetch('/api/start', { method: 'POST' });
    await fetchStatus();
    setLoading(false);
  };

  const handleRestart = async () => {
    setLoading(true);
    try {
      await fetch('/api/restart', { method: 'POST' });
      await fetchStatus();
    } catch (error) {
      console.error('Failed to restart bot:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    await fetch('/api/stop', { method: 'POST' });
    await fetchStatus();
    setLoading(false);
  };

  const handleAddAuthorizedUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAuthorizedUser.trim()) return;
    try {
      const res = await fetch('/api/mod/authorized', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newAuthorizedUser })
      });
      const data = await res.json();
      setAuthorizedUsers(data.users);
      setNewAuthorizedUser('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAuthorizedUser = async (username: string) => {
    try {
      const res = await fetch(`/api/mod/authorized/${username}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      setAuthorizedUsers(data.users);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddAuthorizedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAuthorizedEmail.trim()) return;
    try {
      const cleanEmail = newAuthorizedEmail.toLowerCase().trim();
      const res = await fetch('/api/mod/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail })
      });
      const data = await res.json();
      setAuthorizedEmails(data.emails);
      
      // Sync to Firestore
      try {
        await setDoc(doc(db, 'authorized_emails', cleanEmail), {
          role: 'moderator',
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.WRITE, 'authorized_emails');
      }
      
      setNewAuthorizedEmail('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAuthorizedEmail = async (email: string) => {
    try {
      const cleanEmail = email.toLowerCase().trim();
      const res = await fetch(`/api/mod/emails/${cleanEmail}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      setAuthorizedEmails(data.emails);
      
      // Remove from Firestore
      try {
        await deleteDoc(doc(db, 'authorized_emails', cleanEmail));
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.DELETE, 'authorized_emails');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleApproveRequest = async (req: any) => {
    try {
      // 1. Add to authorized lists via API
      if (req.twitchUsername) {
        await fetch('/api/mod/authorized', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: req.twitchUsername })
        });
      }
      if (req.email) {
        await fetch('/api/mod/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: req.email })
        });
      }
      
      // 2. Update the request status
      try {
        await updateDoc(doc(db, 'access_requests', req.id), { status: 'approved' });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.UPDATE, 'access_requests');
      }
      // We can actually delete it to keep it clean
      // await deleteDoc(doc(db, 'access_requests', req.id));
      
      // Refresh lists
      fetchAuthorizedUsers();
      fetchAuthorizedEmails();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      try {
        await updateDoc(doc(db, 'access_requests', requestId), { status: 'rejected' });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.UPDATE, 'access_requests');
      }
      // Or just delete
      // await deleteDoc(doc(db, 'access_requests', requestId));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || sendingChat) return;
    
    setSendingChat(true);
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatInput })
      });
      if (res.ok) {
        setChatInput('');
        fetchChat();
      }
    } catch (e) {
      console.error(e);
    }
    setSendingChat(false);
  };

  const handleChatAction = async (action: 'timeout' | 'ban' | 'delete', username?: string, messageId?: string) => {
    try {
      await fetch('/api/chat/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, username, messageId, duration: 600 })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddPattern = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPattern.trim()) return;
    try {
      const res = await fetch('/api/mod/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: newPattern.trim() })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        setPatterns(data.patterns);
        setNewPattern('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeletePattern = async (pattern: string) => {
    try {
      const res = await fetch(`/api/mod/patterns/${btoa(pattern)}`, { method: 'DELETE' });
      const data = await res.json();
      setPatterns(data.patterns);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddCustomCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCmd.command.trim() || !newCmd.response.trim()) return;
    if (!newCmd.command.startsWith('!')) {
      alert('Command must start with !');
      return;
    }
    try {
      const res = await fetch('/api/commands/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCmd)
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        setCustomCommands(data.commands);
        setNewCmd({ command: '', response: '' });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteCustomCommand = async (command: string) => {
    try {
      const res = await fetch(`/api/commands/custom/${btoa(command)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.commands) setCustomCommands(data.commands);
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleAutoPunish = async () => {
    const nextValue = !autoPunish;
    setAutoPunish(nextValue);
    try {
      await fetch('/api/mod/autopunish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveWelcomeMessage = async () => {
    try {
      await fetch('/api/mod/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: welcomeEnabled, message: welcomeMessage })
      });

      if (user && user.email === 'fireskyer@gmail.com') {
        try {
          await setDoc(doc(db, 'config', 'bot'), {
            welcomeEnabled,
            welcomeMessage
          }, { merge: true });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'config/bot');
        }
      }

      setSaveStatus('Welcome message updated!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveRankTemplate = async () => {
    try {
      await fetch('/api/mod/rank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: rankTemplate })
      });

      if (user && user.email === 'fireskyer@gmail.com') {
        try {
          await setDoc(doc(db, 'config', 'bot'), {
            rankTemplate
          }, { merge: true });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'config/bot');
        }
      }

      setSaveStatus('Rank template updated!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleWelcome = async () => {
    const nextValue = !welcomeEnabled;
    setWelcomeEnabled(nextValue);
    try {
      await fetch('/api/mod/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue, message: welcomeMessage })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // We save registration requests to a public collection in Firestore
      // This allows the admin to see and approve them
      try {
        await addDoc(collection(db, 'access_requests'), {
          twitchUsername: regData.twitch,
          email: regData.email.toLowerCase(),
          authCode: regData.authCode,
          status: 'pending',
          timestamp: new Date().toISOString()
        });
      } catch (firestoreErr) {
        handleFirestoreError(firestoreErr, OperationType.CREATE, 'access_requests');
      }
      
      setRegSuccess(true);
      // Auto-redirect to login after 3 seconds
      setTimeout(() => {
        setAuthMode('login');
        setRegSuccess(false);
        setRegData({ twitch: '', email: '', authCode: '' });
      }, 3000);
    } catch (err) {
      console.error('Registration failed:', err);
      setLoginError('Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError('');
    try {
      let currentUserEmail = user?.email;
      
      // 1. Ensure Firebase Auth first
      if (!user) {
        try {
          const result = await signInWithPopup(auth, googleProvider);
          currentUserEmail = result.user.email;
        } catch (err: any) {
          setLoginError('Google Sign-In failed: ' + err.message);
          setLoading(false);
          return;
        }
      }

      // 2. Verify Admin Password & Email via API
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          password: adminPass,
          email: currentUserEmail 
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsLoggedIn(true);
        localStorage.setItem('bot_admin_auth', 'true');
      } else {
        if (data.error === 'Your email is not authorized to access this dashboard.') {
          setAuthMode('register');
          if (currentUserEmail) {
            setRegData(prev => ({ ...prev, email: currentUserEmail! }));
          }
          setLoginError('Unauthorized email. Please request access below.');
        } else {
          setLoginError(data.error || 'Login failed');
        }
      }
    } catch (e) {
      setLoginError('Server error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggedIn(false);
    localStorage.removeItem('bot_admin_auth');
    setAdminPass('');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await auth.signOut();
    } catch (e) {
      console.error('Failed to log logout:', e);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSaveStatus('');
    try {
      const filteredCreds = Object.fromEntries(
        Object.entries(creds).filter(([key, value]) => {
          if (key === 'DEFAULT_RIOT_REGION') return true;
          return value !== '';
        })
      );

      await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filteredCreds)
      });

      if (user && user.email === 'fireskyer@gmail.com') {
        try {
          await setDoc(doc(db, 'config', 'bot'), {
            ...filteredCreds,
            evasionPatterns: patterns,
            autoPunish,
            welcomeEnabled,
            welcomeMessage,
            rankTemplate
          }, { merge: true });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'config/bot');
        }
      }

      setSaveStatus('Settings saved successfully!');
      setCreds(prev => ({
        TWITCH_USERNAME: '',
        TWITCH_OAUTH_TOKEN: '',
        TWITCH_CHANNEL: '',
        RIOT_API_KEY: '',
        GEMINI_API_KEY: '',
        ADMIN_PASSWORD: '',
        DEFAULT_RIOT_REGION: prev.DEFAULT_RIOT_REGION
      }));
      await fetchStatus();
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) {
      setSaveStatus('Failed to save settings.');
    }
    setLoading(false);
  };



  const filteredLogs = logs.filter(log => logFilter === 'ALL' || log.type === logFilter);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-sans selection:bg-hextech-cyan/30 flex flex-col relative overflow-hidden">
      {/* Dynamic Hextech Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Base dark gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#1e2328_0%,#0a0a0c_100%)]" />
        
        {/* Animated Grid */}
        <div 
          className="absolute inset-0 opacity-[0.05]" 
          style={{ 
            backgroundImage: 'linear-gradient(#c89b3c 1px, transparent 1px), linear-gradient(90deg, #c89b3c 1px, transparent 1px)', 
            backgroundSize: '50px 50px',
            transform: 'perspective(1000px) rotateX(60deg) translateY(-100px) translateZ(-200px)',
            transformOrigin: 'top center'
          }} 
        />

        {/* Glowing Orbs */}
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.3, 0.1],
            x: [0, 100, 0],
            y: [0, -50, 0]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-hextech-cyan/20 rounded-full blur-[120px]"
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.5, 1],
            opacity: [0.1, 0.2, 0.1],
            x: [0, -100, 0],
            y: [0, 100, 0]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-hextech-gold/10 rounded-full blur-[150px]"
        />

        {/* Floating Magic Particles */}
        <div className="absolute inset-0">
          {[...Array(15)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: '100vh', x: `${Math.random() * 100}vw` }}
              animate={{ 
                opacity: [0, 0.8, 0],
                y: '-10vh',
                x: `${Math.random() * 100}vw`
              }}
              transition={{
                duration: 15 + Math.random() * 15,
                repeat: Infinity,
                delay: Math.random() * 10,
                ease: "linear"
              }}
              className={`absolute w-1 h-1 rounded-full blur-[1px] ${i % 2 === 0 ? 'bg-hextech-cyan' : 'bg-hextech-gold'}`}
              style={{
                boxShadow: `0 0 10px ${i % 2 === 0 ? '#00cfbc' : '#c89b3c'}`
              }}
            />
          ))}
        </div>
        
        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#0a0a0c_100%)] opacity-80" />
      </div>

      {/* Top Navigation */}
      <header className="bg-hextech-blue/60 backdrop-blur-2xl border-b border-hextech-gold/20 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-4">
              {isLoggedIn && user && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="hidden lg:flex items-center gap-3 px-5 py-2 bg-gradient-to-r from-hextech-gold/10 to-transparent border-l-2 border-hextech-gold rounded-r-xl mr-4 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-hextech-gold/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="w-2 h-2 rounded-full bg-hextech-gold animate-pulse shadow-[0_0_8px_rgba(200,155,60,0.8)]" />
                  <span className="text-[10px] font-black text-hextech-gold-bright uppercase tracking-[0.2em] relative z-10">
                    Welcome, {user.displayName || user.email?.split('@')[0]}
                  </span>
                </motion.div>
              )}
              <div className="relative">
                <div className="p-2 bg-hextech-cyan/10 rounded-lg border border-hextech-cyan/20 magic-glow">
                  <FaTwitch className="w-6 h-6 text-hextech-cyan" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-hextech-blue border-2 border-hextech-gold/50 rounded-full flex items-center justify-center">
                  <div className={`w-1.5 h-1.5 rounded-full ${botStatus?.status === 'online' ? 'bg-hextech-cyan animate-pulse' : 'bg-rose-500'}`} />
                </div>
              </div>
              <div>
                <h1 className="text-xl font-black font-display hextech-gradient-text tracking-tight leading-none uppercase">LoLRobujkul</h1>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1">Command Center</p>
              </div>
            </div>
            
            <div className="flex md:hidden items-center gap-3">
              {isLoggedIn && (
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-xl text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all border border-transparent hover:border-rose-500/20"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          {isLoggedIn && (
            <nav className="flex w-full md:w-auto overflow-x-auto hide-scrollbar items-center gap-1 bg-black/20 p-1 rounded-xl border border-hextech-gold/10">
              {(['dashboard', 'chat', 'logs', 'commands', 'mod', 'settings'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-300 flex items-center gap-2 ${
                    activeTab === tab 
                      ? 'bg-hextech-gold/20 text-hextech-gold-bright border border-hextech-gold/30 shadow-[0_0_10px_rgba(200,155,60,0.2)]' 
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {tab === 'dashboard' && <LayoutDashboard className="w-3.5 h-3.5" />}
                  {tab === 'chat' && <MessageSquare className="w-3.5 h-3.5" />}
                  {tab === 'logs' && <FileText className="w-3.5 h-3.5" />}
                  {tab === 'commands' && <Terminal className="w-3.5 h-3.5" />}
                  {tab === 'mod' && <Shield className="w-3.5 h-3.5" />}
                  {tab === 'settings' && <Settings className="w-3.5 h-3.5" />}
                  {tab === 'chat' ? 'Dedicated Chat' : tab}
                </button>
              ))}
            </nav>
          )}

          <div className="hidden md:flex items-center gap-3">
            {isLoggedIn && (
              <button
                onClick={handleLogout}
                className="p-2 rounded-xl text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all border border-transparent hover:border-rose-500/20"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 relative z-10">
        <AnimatePresence mode="wait">
          {!isLoggedIn ? (
            <motion.div
              key={authMode}
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -40 }}
              transition={{ type: "spring", damping: 25, stiffness: 120 }}
              className="max-w-md mx-auto mt-20"
            >
              <div className="glass-card hextech-border rounded-3xl p-10 shadow-2xl relative overflow-hidden group">
                <div className="hextech-corner-br opacity-50 group-hover:scale-110 transition-transform duration-700" />
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-hextech-gold/30 to-transparent" />
                
                <div className="flex flex-col items-center mb-10 relative z-10">
                  <div className="relative mb-8">
                    <div className="p-6 bg-hextech-gold/5 rounded-full border border-hextech-gold/20 magic-glow relative z-10">
                      {authMode === 'login' ? <Lock className="w-12 h-12 text-hextech-gold" /> : <UserPlus className="w-12 h-12 text-hextech-gold" />}
                    </div>
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-0 border-2 border-dashed border-hextech-gold/10 rounded-full -m-2"
                    />
                  </div>
                  <h2 className="text-3xl font-black text-hextech-gold-bright font-display tracking-[0.1em] uppercase text-center">
                    {authMode === 'login' ? 'Security Protocol' : 'Access Registry'}
                  </h2>
                  <div className="w-12 h-1 bg-hextech-gold/30 mt-4 rounded-full" />
                  <p className="text-slate-500 text-[11px] font-bold uppercase tracking-[0.2em] mt-6 text-center">
                    {authMode === 'login' ? 'Identity verification required' : 'Request dashboard authorization'}
                  </p>
                </div>

                {regSuccess ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center py-10 space-y-6 text-center"
                  >
                    <div className="w-20 h-20 bg-hextech-cyan/10 rounded-full flex items-center justify-center border border-hextech-cyan/30 magic-glow">
                      <CheckCircle className="w-10 h-10 text-hextech-cyan" />
                    </div>
                    <div>
                      <h3 className="text-hextech-gold font-black uppercase tracking-widest text-sm mb-2">Request Transmitted</h3>
                      <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                        Your credentials have been queued for review.<br/>Redirecting to login uplink...
                      </p>
                    </div>
                  </motion.div>
                ) : authMode === 'login' ? (
                  <form onSubmit={handleLogin} className="space-y-8 relative z-10">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em]">Authorization Key</label>
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Encrypted Link</span>
                      </div>
                      <input
                        type="password"
                        value={adminPass}
                        onChange={(e) => setAdminPass(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-5 text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono text-lg tracking-[0.5em]"
                        required
                      />
                    </div>

                    {loginError && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-[10px] font-black uppercase tracking-widest text-center"
                      >
                        {loginError}
                      </motion.div>
                    )}

                    <div className="space-y-4">
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full group relative overflow-hidden bg-hextech-cyan hover:bg-hextech-magic disabled:bg-slate-800/50 disabled:text-slate-600 text-hextech-blue py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow"
                      >
                        <span className="relative z-10 flex items-center justify-center gap-3">
                          {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <>Initialize Uplink <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
                        </span>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setAuthMode('register')}
                        className="w-full py-4 text-[10px] font-black text-slate-500 hover:text-hextech-gold uppercase tracking-[0.2em] transition-colors"
                      >
                        Request Access Registry
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleRegister} className="space-y-8 relative z-10">
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Twitch Username</label>
                        <div className="relative group/input">
                          <input
                            type="text"
                            value={regData.twitch}
                            onChange={(e) => setRegData(prev => ({ ...prev, twitch: e.target.value }))}
                            placeholder="e.g. your_twitch_name"
                            className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono shadow-inner"
                            required
                          />
                          <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                            <MessageSquare className="w-5 h-5 text-hextech-gold" />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Google Email</label>
                        <div className="relative group/input">
                          <input
                            type="email"
                            value={regData.email}
                            onChange={(e) => setRegData(prev => ({ ...prev, email: e.target.value }))}
                            placeholder="e.g. user@gmail.com"
                            className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono shadow-inner"
                            required
                          />
                          <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                            <Send className="w-5 h-5 text-hextech-gold" />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Authorization Code</label>
                        <div className="relative group/input">
                          <input
                            type="text"
                            value={regData.authCode}
                            onChange={(e) => setRegData(prev => ({ ...prev, authCode: e.target.value }))}
                            placeholder="e.g. AUTH-1234"
                            className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono shadow-inner"
                            required
                          />
                          <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                            <Key className="w-5 h-5 text-hextech-gold" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {loginError && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-[10px] font-black uppercase tracking-widest text-center"
                      >
                        {loginError}
                      </motion.div>
                    )}

                    <div className="space-y-4">
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full group relative overflow-hidden bg-hextech-gold/10 hover:bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/30 py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow"
                      >
                        <span className="relative z-10 flex items-center justify-center gap-3">
                          {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <>Transmit Request <Send className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" /></>}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAuthMode('login')}
                        className="w-full py-4 text-[10px] font-black text-slate-500 hover:text-hextech-gold uppercase tracking-[0.2em] transition-colors"
                      >
                        Return to Security Protocol
                      </button>
                    </div>
                  </form>
                )}

                {authMode === 'login' && !botStatus?.config.hasAdminPassword && (
                  <div className="mt-10 p-5 bg-hextech-cyan/5 border border-hextech-cyan/20 rounded-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-hextech-cyan/30" />
                    <p className="text-[10px] text-hextech-cyan font-bold uppercase tracking-widest leading-relaxed">
                      <span className="text-white">System Note:</span> No master key detected in registry. Access permitted via null-string or local override.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Left Column: Controls & Config */}
              <div className="space-y-8">
                {/* Bot Statistics */}
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="glass-card hextech-border rounded-2xl p-8 shadow-[0_0_30px_rgba(0,255,255,0.05)] hover:shadow-[0_0_40px_rgba(0,255,255,0.15)] hover:border-hextech-cyan/40 transition-all duration-700 group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-hextech-cyan/5 via-transparent to-hextech-gold/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  <div className="absolute -top-24 -right-24 w-48 h-48 bg-hextech-cyan/10 rounded-full blur-3xl group-hover:bg-hextech-cyan/20 transition-colors duration-700" />
                  <div className="hextech-corner-br opacity-40 group-hover:scale-110 group-hover:opacity-80 transition-all duration-700 magic-glow" />
                  
                  <div className="flex items-center justify-between mb-8 relative z-10">
                    <h2 className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] flex items-center gap-3">
                      <div className="w-8 h-[1px] bg-hextech-gold/30" />
                      Telemetry
                    </h2>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-hextech-cyan animate-pulse" />
                      <span className="text-[8px] font-black text-hextech-cyan uppercase tracking-widest">Live Feed</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-black/40 p-6 rounded-2xl border border-hextech-gold/10 group-hover:border-hextech-gold/20 transition-all relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-12 h-12 bg-hextech-gold/5 rounded-full -mr-6 -mt-6 blur-xl" />
                      <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-3 relative z-10">Signal Count</p>
                      <p className="text-4xl font-black text-hextech-gold-bright font-display tracking-tighter relative z-10">{botStatus?.stats.totalMessages || 0}</p>
                    </div>
                    <div className="bg-black/40 p-6 rounded-2xl border border-hextech-gold/10 group-hover:border-hextech-gold/20 transition-all relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-12 h-12 bg-hextech-cyan/5 rounded-full -mr-6 -mt-6 blur-xl" />
                      <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-3 relative z-10">Logic Cycles</p>
                      <p className="text-4xl font-black text-hextech-cyan font-display tracking-tighter relative z-10">{botStatus?.stats.commandsProcessed || 0}</p>
                    </div>
                  </div>

                  <div className="mt-10 space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[9px] font-black text-hextech-gold uppercase tracking-widest opacity-60">Priority Protocols</h3>
                      <div className="h-[1px] flex-1 bg-hextech-gold/10 mx-4" />
                    </div>
                    <div className="space-y-2">
                      {Object.entries(botStatus?.stats.commandUsage || {})
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 3)
                        .map(([cmd, count]) => (
                          <div key={cmd} className="flex items-center justify-between p-3.5 bg-black/40 rounded-xl border border-hextech-gold/5 hover:border-hextech-gold/20 transition-all group/item">
                            <div className="flex items-center gap-3">
                              <div className="w-1.5 h-1.5 rounded-full bg-hextech-gold/20 group-hover/item:bg-hextech-gold transition-colors" />
                              <span className="text-xs text-slate-300 font-mono font-bold uppercase tracking-tight">{cmd}</span>
                            </div>
                            <span className="text-xs text-hextech-cyan font-black tabular-nums">{count}</span>
                          </div>
                        ))}
                      {(!botStatus?.stats.commandUsage || Object.keys(botStatus.stats.commandUsage).length === 0) && (
                        <div className="flex flex-col items-center justify-center py-8 opacity-40">
                          <Terminal className="w-8 h-8 mb-3 text-slate-600" />
                          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">No data streams detected</p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>

                {/* Status Card */}
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="glass-card hextech-border rounded-2xl p-8 shadow-2xl relative overflow-hidden group"
                >
                  <div className="hextech-corner-br opacity-40" />
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] flex items-center gap-3">
                      <div className="w-8 h-[1px] bg-hextech-gold/30" />
                      Core Engine
                    </h2>
                    <div className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2 border transition-all duration-500 ${
                      botStatus?.status === 'online' ? 'bg-hextech-cyan/10 text-hextech-cyan border-hextech-cyan/20 magic-glow' :
                      botStatus?.status === 'reconnecting' ? 'bg-hextech-gold/10 text-hextech-gold border-hextech-gold/20' :
                      botStatus?.status?.startsWith('error') ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                      'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        botStatus?.status === 'online' ? 'bg-hextech-cyan animate-pulse' :
                        botStatus?.status === 'reconnecting' ? 'bg-hextech-gold animate-bounce' :
                        botStatus?.status?.startsWith('error') ? 'bg-rose-400' :
                        'bg-slate-500'
                      }`} />
                      {botStatus?.status === 'online' ? 'Active' :
                       botStatus?.status === 'reconnecting' ? 'Syncing' :
                       botStatus?.status?.startsWith('error') ? 'Fault' : 'Offline'}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={handleStart}
                      disabled={loading || botStatus?.status === 'online'}
                      className="flex items-center justify-center gap-3 bg-hextech-cyan hover:bg-hextech-magic disabled:bg-slate-800/50 disabled:text-slate-600 text-hextech-blue py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow disabled:shadow-none"
                    >
                      <Play className="w-4 h-4 fill-current" /> Initialize
                    </button>
                    <button
                      onClick={handleStop}
                      disabled={loading || botStatus?.status === 'offline'}
                      className="flex items-center justify-center gap-3 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 disabled:bg-slate-800/50 disabled:text-slate-600 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all border border-rose-500/20 disabled:border-transparent hover:scale-[1.02] active:scale-[0.98]"
                    >
                      <Square className="w-4 h-4 fill-current" /> Terminate
                    </button>
                  </div>
                  <div className="mt-8 pt-8 border-t border-hextech-gold/10 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-1">System Uptime</span>
                      <span className="text-sm font-black text-slate-300 font-mono">{localUptime}</span>
                    </div>
                    <button
                      onClick={handleRestart}
                      disabled={loading}
                      className="p-3 bg-hextech-gold/10 hover:bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/20 rounded-xl transition-all hover:scale-[1.05] active:scale-[0.95] magic-glow"
                      title="Reboot Engine"
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </motion.div>
              </div>

              {/* Middle Column: Configuration */}
              <div className="space-y-8">
                {/* Quick Rank Template */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="glass-card hextech-border rounded-2xl p-8 shadow-2xl group relative overflow-hidden"
                >
                  <div className="hextech-corner-br opacity-40" />
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] flex items-center gap-3">
                      <div className="w-8 h-[1px] bg-hextech-gold/30" />
                      Output Template
                    </h2>
                    <button onClick={() => setActiveTab('mod')} className="text-[9px] font-black text-hextech-cyan hover:text-hextech-magic uppercase tracking-widest transition-colors flex items-center gap-1.5">
                      <Settings className="w-3 h-3" /> Full Config
                    </button>
                  </div>
                  <div className="space-y-6">
                    <div className="relative group/input">
                      <div className="absolute -top-2 left-3 px-2 bg-hextech-blue text-[8px] font-black text-hextech-gold uppercase tracking-widest z-10 border border-hextech-gold/20 rounded">Rank Format</div>
                      <input
                        type="text"
                        value={rankTemplate}
                        onChange={(e) => setRankTemplate(e.target.value)}
                        placeholder="{game_name}'s Ranks | LoL: {lol_rank}"
                        className="w-full bg-black/60 border border-hextech-gold/20 rounded-xl px-5 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono"
                      />
                      <div className="absolute top-0 right-0 h-full flex items-center pr-4 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                        <MessageSquare className="w-4 h-4 text-hextech-gold" />
                      </div>
                    </div>
                    <button
                      onClick={handleSaveRankTemplate}
                      className="w-full flex items-center justify-center gap-3 bg-hextech-gold/10 hover:bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/30 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.01] active:scale-[0.99] magic-glow"
                    >
                      <Save className="w-4 h-4" /> Commit Changes
                    </button>
                  </div>
                </motion.div>

                {/* Configuration Status */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="glass-card hextech-border rounded-2xl p-8 shadow-2xl relative overflow-hidden"
                >
                  <div className="hextech-corner-br opacity-40" />
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] flex items-center gap-3">
                      <div className="w-8 h-[1px] bg-hextech-gold/30" />
                      Environment
                    </h2>
                    <button onClick={() => setActiveTab('settings')} className="text-[9px] font-black text-hextech-cyan hover:text-hextech-magic uppercase tracking-widest transition-colors flex items-center gap-1.5">
                      <Terminal className="w-3 h-3" /> Registry
                    </button>
                  </div>
                  <div className="space-y-3">
                    <ConfigItem label="TWITCH_USERNAME" isSet={botStatus?.config.hasTwitchUser ?? false} />
                    <ConfigItem label="TWITCH_OAUTH_TOKEN" isSet={botStatus?.config.hasTwitchToken ?? false} />
                    <ConfigItem label="TWITCH_CHANNEL" isSet={botStatus?.config.hasTwitchChannel ?? false} />
                    <ConfigItem label="RIOT_API_KEY" isSet={botStatus?.config.hasRiotKey ?? false} />
                    <ConfigItem label="GEMINI_API_KEY" isSet={botStatus?.config.hasGeminiKey ?? false} />
                  </div>
                </motion.div>
              </div>

              {/* Right Column: Activity Feed */}
              <div className="space-y-8">
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                  className="glass-card hextech-border rounded-2xl p-8 shadow-2xl h-full flex flex-col relative overflow-hidden group"
                >
                  <div className="hextech-corner-br opacity-40" />
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] flex items-center gap-3">
                      <div className="w-8 h-[1px] bg-hextech-gold/30" />
                      Live Feed
                    </h2>
                    <button onClick={() => setActiveTab('logs')} className="text-[9px] font-black text-hextech-cyan hover:text-hextech-magic uppercase tracking-widest transition-colors flex items-center gap-1.5">
                      <FileText className="w-3 h-3" /> Archives
                    </button>
                  </div>
                  <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-2 max-h-[600px]">
                    {logs.slice(0, 10).map((log, i) => (
                      <div key={i} className="p-4 bg-black/40 rounded-2xl border border-hextech-gold/5 hover:border-hextech-gold/20 transition-all group/item relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-hextech-gold/10 group-hover/item:bg-hextech-gold/30 transition-colors" />
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-[8px] font-black uppercase tracking-[0.2em] px-2 py-1 rounded-lg border ${
                            log.type === 'ERROR' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                            log.type === 'MOD' ? 'bg-hextech-gold/10 text-hextech-gold border-hextech-gold/20' :
                            log.type === 'CHAT' ? 'bg-hextech-cyan/10 text-hextech-cyan border-hextech-cyan/20' :
                            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          }`}>
                            {log.type}
                          </span>
                          <span className="text-[9px] font-mono font-bold text-slate-600 group-hover/item:text-slate-400 transition-colors tabular-nums">{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 group-hover/item:text-slate-200 transition-colors font-medium">{log.message}</p>
                      </div>
                    ))}
                    {logs.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-32 opacity-30">
                        <Activity className="w-12 h-12 mb-4 text-slate-600" />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em]">No activity detected</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}


          {activeTab === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card hextech-border rounded-2xl flex flex-col shadow-2xl overflow-hidden h-[calc(100vh-10rem)]"
            >
              <div className="px-6 py-5 border-b border-hextech-gold/10 bg-black/40 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-hextech-cyan/10 rounded-lg border border-hextech-cyan/20">
                    <MessageSquare className="w-5 h-5 text-hextech-cyan" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-hextech-gold-bright uppercase tracking-[0.2em] font-display">Twitch Uplink</h2>
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mt-0.5">Real-time Signal Intercept</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-hextech-cyan/5 border border-hextech-cyan/20 rounded-lg">
                    <div className={`w-1.5 h-1.5 rounded-full ${botStatus?.status === 'online' ? 'bg-hextech-cyan animate-pulse' : 'bg-rose-500'}`} />
                    <span className="text-[8px] font-black text-hextech-cyan uppercase tracking-widest">
                      {botStatus?.status === 'online' ? 'Link Established' : 'Link Severed'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar bg-black/60 space-y-4">
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-20">
                    <MessageSquare className="w-16 h-16 mb-4 text-slate-600" />
                    <p className="text-[11px] font-black uppercase tracking-[0.3em]">No signals detected in this sector</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={msg.id} 
                      className="flex flex-col gap-1 group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono font-bold text-slate-600 tabular-nums">{format(new Date(msg.timestamp), 'HH:mm')}</span>
                        <span className="text-[11px] font-black uppercase tracking-tight" style={{ color: msg.color || '#c89b3c' }}>{msg.username}</span>
                        {msg.badges && Object.keys(msg.badges).length > 0 && (
                          <div className="flex gap-1">
                            {Object.keys(msg.badges).map(badge => (
                              <div key={badge} className="w-3 h-3 bg-hextech-gold/20 rounded-sm border border-hextech-gold/30" title={badge} />
                            ))}
                          </div>
                        )}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleChatAction('delete', undefined, msg.id)}
                            className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded transition-colors"
                            title="Delete Message"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleChatAction('timeout', msg.username)}
                            className="p-1 hover:bg-amber-500/20 text-slate-500 hover:text-amber-400 rounded transition-colors"
                            title="Timeout (10m)"
                          >
                            <Clock className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleChatAction('ban', msg.username)}
                            className="p-1 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded transition-colors"
                            title="Ban User"
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed font-medium pl-11 group-hover:text-white transition-colors">{msg.message}</p>
                    </motion.div>
                  ))
                )}
              </div>

              <div className="p-6 bg-black/40 border-t border-hextech-gold/10">
                <form onSubmit={handleSendMessage} className="flex gap-4">
                  <div className="flex-1 relative group">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={botStatus?.status === 'online' ? "Transmit message to Twitch chat..." : "Bot is offline - Uplink unavailable"}
                      disabled={botStatus?.status !== 'online' || sendingChat}
                      className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-sm text-white placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover:opacity-40 transition-opacity">
                      <Terminal className="w-5 h-5 text-hextech-gold" />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || botStatus?.status !== 'online' || sendingChat}
                    className="bg-hextech-cyan hover:bg-hextech-magic disabled:bg-slate-800/50 disabled:text-slate-600 text-hextech-blue px-8 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow disabled:shadow-none flex items-center gap-3"
                  >
                    {sendingChat ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Transmit
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card hextech-border rounded-2xl flex flex-col shadow-2xl overflow-hidden h-[calc(100vh-10rem)]"
            >
              <div className="px-6 py-5 border-b border-hextech-gold/10 bg-black/40 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-hextech-gold/10 rounded-lg border border-hextech-gold/20">
                    <FileText className="w-5 h-5 text-hextech-gold" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-hextech-gold-bright uppercase tracking-[0.2em] font-display">System Archives</h2>
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mt-0.5">Historical Telemetry Data</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-hextech-gold/10">
                    {(['ALL', 'INFO', 'CHAT', 'MOD', 'ERROR'] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => setLogFilter(type)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                          logFilter === type 
                            ? 'bg-hextech-gold/20 text-hextech-gold-bright border border-hextech-gold/30 shadow-[0_0_10px_rgba(200,155,60,0.2)]' 
                            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-6 bg-hextech-gold/20 mx-2" />
                  <button 
                    onClick={fetchLogs} 
                    className="p-2 text-slate-400 hover:text-hextech-cyan hover:bg-hextech-cyan/10 rounded-xl transition-all border border-transparent hover:border-hextech-cyan/20"
                    title="Refresh Feed"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              <div className="flex-1 p-6 bg-black/60 font-mono text-[11px] overflow-y-auto custom-scrollbar">
                {filteredLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-600 opacity-40">
                    <Terminal className="w-12 h-12 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No data streams found</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filteredLogs.map((log, i) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.01 }}
                        key={i} 
                        className="flex gap-4 text-slate-400 break-words leading-relaxed hover:bg-white/5 p-2 -mx-2 rounded-xl transition-all group border border-transparent hover:border-white/5"
                      >
                        <span className="text-[10px] text-slate-600 shrink-0 font-bold group-hover:text-slate-500 transition-colors">{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
                        <span className={`shrink-0 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest h-fit mt-0.5 ${
                          log.type === 'ERROR' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                          log.type === 'MOD' ? 'bg-hextech-gold/10 text-hextech-gold border border-hextech-gold/20' :
                          log.type === 'CHAT' ? 'bg-hextech-cyan/10 text-hextech-cyan border border-hextech-cyan/20' :
                          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {log.type}
                        </span>
                        <span className={`flex-1 ${log.type === 'ERROR' ? 'text-rose-300/90' : log.type === 'MOD' ? 'text-hextech-gold-bright' : 'text-slate-300/90'}`}>
                          {log.message}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'commands' && (
            <motion.div 
              key="commands"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl mx-auto space-y-8"
            >
              <div className="glass-card hextech-border rounded-2xl p-10 shadow-2xl relative overflow-hidden">
                <div className="hextech-corner-br opacity-30" />
                <div className="flex items-center gap-6 mb-12">
                  <div className="p-4 bg-hextech-cyan/10 rounded-2xl border border-hextech-cyan/20 magic-glow shadow-[0_0_20px_rgba(0,255,255,0.1)]">
                    <Zap className="w-8 h-8 text-hextech-cyan" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-hextech-gold-bright uppercase tracking-[0.3em] font-display">Custom Protocols</h2>
                    <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Define automated response sequences for the uplink</p>
                  </div>
                </div>

                <form onSubmit={handleAddCustomCommand} className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16 bg-black/40 p-8 rounded-3xl border border-hextech-gold/10 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-hextech-gold/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Trigger Key</label>
                    <div className="relative group/input">
                      <input
                        type="text"
                        value={newCmd.command}
                        onChange={(e) => setNewCmd({ ...newCmd, command: e.target.value })}
                        placeholder="!protocol"
                        className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-5 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono"
                      />
                      <div className="absolute top-0 right-0 h-full flex items-center pr-4 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                        <Terminal className="w-4 h-4 text-hextech-gold" />
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2 space-y-3">
                    <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Response Payload</label>
                    <div className="relative group/input">
                      <input
                        type="text"
                        value={newCmd.response}
                        onChange={(e) => setNewCmd({ ...newCmd, response: e.target.value })}
                        placeholder="Automated message content..."
                        className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-5 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all"
                      />
                      <div className="absolute top-0 right-0 h-full flex items-center pr-4 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                        <MessageSquare className="w-4 h-4 text-hextech-gold" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={!newCmd.command.trim() || !newCmd.response.trim()}
                      className="w-full flex items-center justify-center gap-3 bg-hextech-cyan hover:bg-hextech-magic disabled:bg-slate-800/50 disabled:text-slate-600 text-hextech-blue py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow disabled:shadow-none"
                    >
                      <Plus className="w-4 h-4" /> Register
                    </button>
                  </div>
                </form>

                <div className="space-y-8">
                  <div className="flex items-center justify-between px-2">
                    <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.3em] flex items-center gap-4">
                      <div className="w-12 h-[1px] bg-hextech-gold/30" />
                      Active Protocols ({Object.keys(customCommands).length})
                    </h3>
                    <div className="h-[1px] flex-1 bg-hextech-gold/10 mx-8" />
                  </div>
                  
                  {Object.keys(customCommands).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 bg-black/20 border border-dashed border-hextech-gold/10 rounded-3xl text-slate-600">
                      <Terminal className="w-16 h-16 mb-6 opacity-10" />
                      <p className="text-[11px] font-black uppercase tracking-[0.3em]">No custom protocols registered</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {Object.entries(customCommands).map(([cmd, resp]) => (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          key={cmd} 
                          className="flex flex-col p-6 bg-black/40 rounded-3xl border border-hextech-gold/10 group hover:border-hextech-gold/30 transition-all duration-300 relative overflow-hidden"
                        >
                          <div className="absolute top-0 left-0 w-1 h-full bg-hextech-gold/20 group-hover:bg-hextech-gold/40 transition-colors" />
                          <div className="flex items-center justify-between mb-4 relative z-10">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-hextech-gold/10 rounded-xl border border-hextech-gold/20">
                                <Terminal className="w-4 h-4 text-hextech-gold" />
                              </div>
                              <span className="text-sm font-black text-hextech-gold-bright font-mono tracking-tight">{cmd}</span>
                            </div>
                            <button
                              onClick={() => handleDeleteCustomCommand(cmd)}
                              className="text-slate-600 hover:text-rose-400 p-2 rounded-xl hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 border border-transparent hover:border-rose-500/20"
                              title="Decommission Protocol"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-slate-400 text-xs leading-relaxed line-clamp-2 relative z-10 font-medium">"{resp}"</p>
                          <div className="absolute top-0 right-0 w-24 h-24 bg-hextech-gold/5 blur-3xl -mr-12 -mt-12 rounded-full" />
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'mod' && (
            <motion.div 
              key="mod"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl mx-auto space-y-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Welcome Message Section */}
                <div className="glass-card hextech-border rounded-2xl p-10 shadow-2xl flex flex-col relative overflow-hidden group">
                  <div className="hextech-corner-br opacity-30" />
                  <div className="flex items-center gap-6 mb-10">
                    <div className="p-4 bg-hextech-cyan/10 rounded-2xl border border-hextech-cyan/20 magic-glow shadow-[0_0_20px_rgba(0,255,255,0.1)]">
                      <MessageSquare className="w-8 h-8 text-hextech-cyan" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-hextech-gold-bright uppercase tracking-[0.3em] font-display">Greeting Protocol</h2>
                      <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Automated user onboarding sequence</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-6 bg-black/40 border border-hextech-gold/10 rounded-3xl mb-10 group/toggle hover:border-hextech-gold/20 transition-all relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-hextech-cyan/20 group-hover/toggle:bg-hextech-cyan/40 transition-colors" />
                    <div className="flex items-center gap-5">
                      <div className={`p-3 rounded-2xl transition-all duration-500 ${welcomeEnabled ? 'bg-hextech-cyan/20 text-hextech-cyan magic-glow' : 'bg-slate-800 text-slate-600'}`}>
                        <Play className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.2em]">Active Status</h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Trigger on first signal</p>
                      </div>
                    </div>
                    <button
                      onClick={handleToggleWelcome}
                      className={`relative inline-flex h-7 w-14 items-center rounded-full transition-all duration-500 focus:outline-none shadow-inner ${welcomeEnabled ? 'bg-hextech-cyan' : 'bg-slate-800'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-500 shadow-lg ${welcomeEnabled ? 'translate-x-8' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <div className="space-y-8 flex-1 flex flex-col">
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em]">Message Template</label>
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Use <span className="text-hextech-cyan">@user</span> for targeting</span>
                      </div>
                      <textarea
                        value={welcomeMessage}
                        onChange={(e) => setWelcomeMessage(e.target.value)}
                        placeholder="Welcome to the stream, @user!"
                        rows={5}
                        className="w-full bg-black/60 border border-hextech-gold/20 rounded-3xl px-6 py-5 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all resize-none font-medium leading-relaxed shadow-inner"
                      />
                    </div>
                    <button
                      onClick={handleSaveWelcomeMessage}
                      className="w-full flex items-center justify-center gap-3 bg-hextech-gold/10 hover:bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/30 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow"
                    >
                      <Save className="w-4 h-4" /> Commit Greeting
                    </button>
                  </div>
                </div>

                {/* Rank Template Section */}
                <div className="glass-card hextech-border rounded-2xl p-10 shadow-2xl flex flex-col relative overflow-hidden group">
                  <div className="hextech-corner-br opacity-30" />
                  <div className="flex items-center gap-6 mb-10">
                    <div className="p-4 bg-hextech-magic/10 rounded-2xl border border-hextech-magic/20 magic-glow shadow-[0_0_20px_rgba(150,100,255,0.1)]">
                      <Activity className="w-8 h-8 text-hextech-magic" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-hextech-gold-bright uppercase tracking-[0.3em] font-display">Rank Analytics</h2>
                      <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Data visualization format for uplink</p>
                    </div>
                  </div>

                  <div className="bg-black/40 p-8 rounded-3xl border border-hextech-gold/10 mb-10 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-hextech-magic/5 blur-3xl -mr-16 -mt-16 rounded-full" />
                    <h3 className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] mb-6 flex items-center gap-3 relative z-10">
                      <Zap className="w-3.5 h-3.5" /> Available Variables
                    </h3>
                    <div className="flex flex-wrap gap-3 relative z-10">
                      {['{game_name}', '{lol_rank}', '{tft_rank}'].map(tag => (
                        <code key={tag} className="text-[10px] bg-hextech-magic/10 text-hextech-magic px-3.5 py-1.5 rounded-xl border border-hextech-magic/20 font-mono font-bold shadow-sm">{tag}</code>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-8 flex-1 flex flex-col">
                    <div className="flex-1 space-y-4">
                      <label className="block text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Output Format</label>
                      <div className="relative group/input">
                        <input
                          type="text"
                          value={rankTemplate}
                          onChange={(e) => setRankTemplate(e.target.value)}
                          placeholder="{game_name}'s Ranks | LoL: {lol_rank}"
                          className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-5 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono shadow-inner"
                        />
                        <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                          <Terminal className="w-5 h-5 text-hextech-gold" />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleSaveRankTemplate}
                      className="w-full flex items-center justify-center gap-3 bg-hextech-magic/10 hover:bg-hextech-magic/20 text-hextech-magic border border-hextech-magic/30 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow"
                    >
                      <Save className="w-4 h-4" /> Commit Template
                    </button>
                  </div>
                </div>
              </div>

              {/* Security Protocols Section */}
              <div className="glass-card hextech-border rounded-2xl p-10 shadow-2xl relative overflow-hidden group">
                <div className="hextech-corner-br opacity-30" />
                <div className="flex items-center gap-6 mb-10">
                  <div className="p-4 bg-hextech-gold/10 rounded-2xl border border-hextech-gold/20 magic-glow shadow-[0_0_20px_rgba(255,200,0,0.1)]">
                    <Shield className="w-8 h-8 text-hextech-gold" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-hextech-gold-bright uppercase tracking-[0.3em] font-display">Security Protocols</h2>
                    <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Advanced threat mitigation & evasion detection</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-6 bg-black/40 border border-hextech-gold/10 rounded-3xl mb-12 group/toggle hover:border-hextech-gold/20 transition-all relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-hextech-gold/20 group-hover/toggle:bg-hextech-gold/40 transition-colors" />
                  <div className="flex items-center gap-5">
                    <div className={`p-3 rounded-2xl transition-all duration-500 ${autoPunish ? 'bg-hextech-cyan/20 text-hextech-cyan magic-glow' : 'bg-slate-800 text-slate-600'}`}>
                      <Zap className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.2em]">Auto-Punish Warnings</h3>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Whisper suspected evaders automatically</p>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleAutoPunish}
                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-all duration-500 focus:outline-none shadow-inner ${autoPunish ? 'bg-hextech-cyan' : 'bg-slate-800'}`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-500 shadow-lg ${autoPunish ? 'translate-x-8' : 'translate-x-1'}`} />
                  </button>
                </div>

                <form onSubmit={handleAddPattern} className="flex flex-col md:flex-row gap-6 mb-12 bg-black/40 p-8 rounded-3xl border border-hextech-gold/10 relative overflow-hidden group/form">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-hextech-gold/20 to-transparent opacity-0 group-hover/form:opacity-100 transition-opacity" />
                  <div className="flex-1 space-y-3">
                    <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Regex Pattern</label>
                    <div className="relative group/input">
                      <input
                        type="text"
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                        placeholder="e.g. ^banneduser\d+$"
                        className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono shadow-inner"
                      />
                      <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                        <Terminal className="w-5 h-5 text-hextech-gold" />
                      </div>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={!newPattern.trim()}
                    className="md:self-end flex items-center justify-center gap-3 bg-hextech-cyan hover:bg-hextech-magic disabled:bg-slate-800/50 disabled:text-slate-600 text-hextech-blue px-10 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow disabled:shadow-none h-[52px]"
                  >
                    <Plus className="w-4 h-4" /> Register Pattern
                  </button>
                </form>

                <div className="space-y-6">
                  <div className="flex items-center justify-between px-2">
                    <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.3em] flex items-center gap-4">
                      <div className="w-12 h-[1px] bg-hextech-gold/30" />
                      Active Patterns ({patterns.length})
                    </h3>
                    <div className="h-[1px] flex-1 bg-hextech-gold/10 mx-8" />
                  </div>
                  
                  {patterns.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-black/20 border border-dashed border-hextech-gold/10 rounded-3xl text-slate-600">
                      <Shield className="w-12 h-12 mb-4 opacity-10" />
                      <p className="text-[11px] font-black uppercase tracking-[0.3em]">No evasion patterns configured</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {patterns.map((pattern, i) => (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          key={i} 
                          className="flex items-center justify-between p-5 bg-black/40 rounded-2xl border border-hextech-gold/10 group/item hover:border-hextech-gold/30 transition-all relative overflow-hidden"
                        >
                          <div className="absolute top-0 left-0 w-1 h-full bg-hextech-gold/10 group-hover/item:bg-hextech-gold/30 transition-colors" />
                          <code className="text-hextech-cyan font-mono text-sm font-black tracking-tight relative z-10">{pattern}</code>
                          <button
                            onClick={() => handleDeletePattern(pattern)}
                            className="text-slate-600 hover:text-rose-400 p-2 rounded-xl hover:bg-rose-500/10 transition-all opacity-0 group-hover/item:opacity-100 focus:opacity-100 border border-transparent hover:border-rose-500/20 relative z-10"
                            title="Delete Pattern"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Access Requests Section */}
                {accessRequests.filter(r => r.status === 'pending').length > 0 && (
                  <div className="mt-16 pt-16 border-t border-hextech-gold/10">
                    <div className="flex items-center gap-6 mb-10">
                      <div className="p-4 bg-hextech-cyan/10 rounded-2xl border border-hextech-cyan/20 magic-glow shadow-[0_0_20px_rgba(0,255,255,0.1)]">
                        <Activity className="w-8 h-8 text-hextech-cyan" />
                      </div>
                      <div>
                        <h2 className="text-xl font-black text-hextech-cyan uppercase tracking-[0.3em] font-display">Pending Access Requests</h2>
                        <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">New operator applications requiring review</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {accessRequests.filter(r => r.status === 'pending').map((req) => (
                        <motion.div 
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          key={req.id} 
                          className="flex flex-col md:flex-row items-center justify-between p-8 bg-black/40 rounded-3xl border border-hextech-cyan/20 group/req hover:border-hextech-cyan/40 transition-all relative overflow-hidden"
                        >
                          <div className="absolute top-0 left-0 w-1 h-full bg-hextech-cyan/30" />
                          <div className="flex flex-col md:flex-row items-center gap-8 relative z-10">
                            <div className="flex items-center gap-4">
                              <div className="p-3 bg-hextech-cyan/5 rounded-xl border border-hextech-cyan/10">
                                <MessageSquare className="w-5 h-5 text-hextech-cyan/60" />
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Twitch</p>
                                <p className="text-white font-black uppercase tracking-tight text-sm">{req.twitchUsername}</p>
                              </div>
                            </div>
                            <div className="w-[1px] h-8 bg-hextech-cyan/10 hidden md:block" />
                            <div className="flex items-center gap-4">
                              <div className="p-3 bg-hextech-cyan/5 rounded-xl border border-hextech-cyan/10">
                                <Send className="w-5 h-5 text-hextech-cyan/60" />
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Email</p>
                                <p className="text-white font-bold tracking-tight text-sm">{req.email}</p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4 mt-6 md:mt-0 relative z-10">
                            <button
                              onClick={() => handleRejectRequest(req.id)}
                              className="px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all border border-transparent hover:border-rose-500/20"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleApproveRequest(req)}
                              className="px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-hextech-cyan/10 text-hextech-cyan border border-hextech-cyan/30 hover:bg-hextech-cyan/20 transition-all magic-glow"
                            >
                              Approve Access
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Authorized Personnel Section */}
                <div className="mt-16 pt-16 border-t border-hextech-gold/10">
                  <div className="flex items-center gap-6 mb-10">
                    <div className="p-4 bg-hextech-gold/10 rounded-2xl border border-hextech-gold/20 magic-glow shadow-[0_0_20px_rgba(255,200,0,0.1)]">
                      <ShieldCheck className="w-8 h-8 text-hextech-gold" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-hextech-gold-bright uppercase tracking-[0.3em] font-display">Authorized Personnel</h2>
                      <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Access control & operator registration</p>
                    </div>
                  </div>

                  <form onSubmit={handleAddAuthorizedUser} className="flex flex-col md:flex-row gap-6 mb-12 bg-black/40 p-8 rounded-3xl border border-hextech-gold/10 relative overflow-hidden group/form">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-hextech-gold/20 to-transparent opacity-0 group-hover/form:opacity-100 transition-opacity" />
                    <div className="flex-1 space-y-3">
                      <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Twitch Username</label>
                      <div className="relative group/input">
                        <input
                          type="text"
                          value={newAuthorizedUser}
                          onChange={(e) => setNewAuthorizedUser(e.target.value)}
                          placeholder="e.g. moderator_name"
                          className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono shadow-inner"
                        />
                        <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                          <UserIcon className="w-5 h-5 text-hextech-gold" />
                        </div>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={!newAuthorizedUser.trim()}
                      className="md:self-end flex items-center justify-center gap-3 bg-hextech-gold/10 hover:bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/30 px-10 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow disabled:shadow-none h-[52px]"
                    >
                      <Plus className="w-4 h-4" /> Register Operator
                    </button>
                  </form>

                  <div className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.3em] flex items-center gap-4">
                        <div className="w-12 h-[1px] bg-hextech-gold/30" />
                        Active Operators ({authorizedUsers.length})
                      </h3>
                      <div className="h-[1px] flex-1 bg-hextech-gold/10 mx-8" />
                    </div>
                    
                    {authorizedUsers.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 bg-black/20 border border-dashed border-hextech-gold/10 rounded-3xl text-slate-600">
                        <UserIcon className="w-12 h-12 mb-4 opacity-10" />
                        <p className="text-[11px] font-black uppercase tracking-[0.3em]">No operators registered</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {authorizedUsers.map((username, i) => (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            key={i} 
                            className="flex items-center justify-between p-5 bg-black/40 rounded-2xl border border-hextech-gold/10 group/item hover:border-hextech-gold/30 transition-all relative overflow-hidden"
                          >
                            <div className="absolute top-0 left-0 w-1 h-full bg-hextech-gold/10 group-hover/item:bg-hextech-gold/30 transition-colors" />
                            <div className="flex items-center gap-3 relative z-10">
                              <div className="p-2 bg-hextech-gold/5 rounded-lg border border-hextech-gold/10">
                                <UserIcon className="w-3.5 h-3.5 text-hextech-gold/60" />
                              </div>
                              <span className="text-slate-200 font-black tracking-tight uppercase text-[11px]">{username}</span>
                            </div>
                            <button
                              onClick={() => handleDeleteAuthorizedUser(username)}
                              className="text-slate-600 hover:text-rose-400 p-2 rounded-xl hover:bg-rose-500/10 transition-all opacity-0 group-hover/item:opacity-100 focus:opacity-100 border border-transparent hover:border-rose-500/20 relative z-10"
                              title="Revoke Access"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-16 pt-16 border-t border-hextech-gold/10">
                    <div className="flex items-center gap-6 mb-10">
                      <div className="p-4 bg-hextech-gold/10 rounded-2xl border border-hextech-gold/20 magic-glow shadow-[0_0_20px_rgba(255,200,0,0.1)]">
                        <Globe className="w-8 h-8 text-hextech-gold" />
                      </div>
                      <div>
                        <h2 className="text-xl font-black text-hextech-gold-bright uppercase tracking-[0.3em] font-display">Dashboard Access</h2>
                        <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Web interface authorization via Google Email</p>
                      </div>
                    </div>

                    <form onSubmit={handleAddAuthorizedEmail} className="flex flex-col md:flex-row gap-6 mb-12 bg-black/40 p-8 rounded-3xl border border-hextech-gold/10 relative overflow-hidden group/form">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-hextech-gold/20 to-transparent opacity-0 group-hover/form:opacity-100 transition-opacity" />
                      <div className="flex-1 space-y-3">
                        <label className="text-[10px] font-black text-hextech-gold uppercase tracking-[0.2em] ml-1">Google Email Address</label>
                        <div className="relative group/input">
                          <input
                            type="email"
                            value={newAuthorizedEmail}
                            onChange={(e) => setNewAuthorizedEmail(e.target.value)}
                            placeholder="e.g. user@gmail.com"
                            className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white placeholder:text-slate-800 focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all font-mono shadow-inner"
                          />
                          <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                            <Send className="w-5 h-5 text-hextech-gold" />
                          </div>
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={!newAuthorizedEmail.trim()}
                        className="md:self-end flex items-center justify-center gap-3 bg-hextech-gold/10 hover:bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/30 px-10 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow disabled:shadow-none h-[52px]"
                      >
                        <Plus className="w-4 h-4" /> Grant Web Access
                      </button>
                    </form>

                    <div className="space-y-6">
                      <div className="flex items-center justify-between px-2">
                        <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.3em] flex items-center gap-4">
                          <div className="w-12 h-[1px] bg-hextech-gold/30" />
                          Authorized Emails ({authorizedEmails.length})
                        </h3>
                        <div className="h-[1px] flex-1 bg-hextech-gold/10 mx-8" />
                      </div>
                      
                      {authorizedEmails.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-black/20 border border-dashed border-hextech-gold/10 rounded-3xl text-slate-600">
                          <Globe className="w-12 h-12 mb-4 opacity-10" />
                          <p className="text-[11px] font-black uppercase tracking-[0.3em]">No external web access granted</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {authorizedEmails.map((email, i) => (
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              key={i} 
                              className="flex items-center justify-between p-5 bg-black/40 rounded-2xl border border-hextech-gold/10 group/item hover:border-hextech-gold/30 transition-all relative overflow-hidden"
                            >
                              <div className="absolute top-0 left-0 w-1 h-full bg-hextech-gold/10 group-hover/item:bg-hextech-gold/30 transition-colors" />
                              <div className="flex items-center gap-3 relative z-10">
                                <div className="p-2 bg-hextech-gold/5 rounded-lg border border-hextech-gold/10">
                                  <Send className="w-3.5 h-3.5 text-hextech-gold/60" />
                                </div>
                                <span className="text-slate-200 font-bold tracking-tight text-[11px] truncate max-w-[150px]">{email}</span>
                              </div>
                              <button
                                onClick={() => handleDeleteAuthorizedEmail(email)}
                                className="text-slate-600 hover:text-rose-400 p-2 rounded-xl hover:bg-rose-500/10 transition-all opacity-0 group-hover/item:opacity-100 focus:opacity-100 border border-transparent hover:border-rose-500/20 relative z-10"
                                title="Revoke Web Access"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl mx-auto"
            >
              <div className="glass-card hextech-border rounded-2xl shadow-2xl overflow-hidden relative group">
                <div className="hextech-corner-br opacity-30" />
                <div className="px-10 py-8 border-b border-hextech-gold/10 bg-black/40 flex items-center gap-6">
                  <div className="p-4 bg-hextech-gold/10 rounded-2xl border border-hextech-gold/20 magic-glow shadow-[0_0_20px_rgba(255,200,0,0.1)]">
                    <Settings className="w-8 h-8 text-hextech-gold" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-hextech-gold-bright uppercase tracking-[0.3em] font-display">System Registry</h2>
                    <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Core parameter configuration & uplink management</p>
                  </div>
                </div>
                
                <div className="p-10">
                  <form onSubmit={handleSaveSettings} className="space-y-12">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      <div className="space-y-8">
                        <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.3em] flex items-center gap-4 mb-8">
                          <div className="w-12 h-[1px] bg-hextech-gold/30" />
                          Twitch Uplink
                        </h3>
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Username</label>
                            <div className="relative group/input">
                              <input
                                type="text"
                                value={creds.TWITCH_USERNAME}
                                onChange={(e) => setCreds({...creds, TWITCH_USERNAME: e.target.value})}
                                placeholder={botStatus?.config.hasTwitchUser ? '******** (Configured)' : 'e.g. my_awesome_bot'}
                                className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all shadow-inner"
                              />
                              <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                                <UserIcon className="w-5 h-5 text-hextech-gold" />
                              </div>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">OAuth Token</label>
                            <div className="relative group/input">
                              <input
                                type="password"
                                value={creds.TWITCH_OAUTH_TOKEN}
                                onChange={(e) => setCreds({...creds, TWITCH_OAUTH_TOKEN: e.target.value})}
                                placeholder={botStatus?.config.hasTwitchToken ? '******** (Configured)' : 'oauth:xxxxxxxxxxxxxxxxxxxx'}
                                className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all shadow-inner"
                              />
                              <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                                <Key className="w-5 h-5 text-hextech-gold" />
                              </div>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Target Channel</label>
                            <div className="relative group/input">
                              <input
                                type="text"
                                value={creds.TWITCH_CHANNEL}
                                onChange={(e) => setCreds({...creds, TWITCH_CHANNEL: e.target.value})}
                                placeholder={botStatus?.config.hasTwitchChannel ? '******** (Configured)' : 'e.g. my_channel_name'}
                                className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all shadow-inner"
                              />
                              <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                                <Zap className="w-5 h-5 text-hextech-gold" />
                              </div>
                            </div>
                          </div>
                        </div>
                                    <div className="space-y-8">
                        <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.3em] flex items-center gap-4 mb-8">
                          <div className="w-12 h-[1px] bg-hextech-gold/30" />
                          API Interfaces
                        </h3>
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Riot API Key</label>
                            <div className="relative group/input">
                              <input
                                type="password"
                                value={creds.RIOT_API_KEY}
                                onChange={(e) => setCreds({...creds, RIOT_API_KEY: e.target.value})}
                                placeholder={botStatus?.config.hasRiotKey ? '******** (Configured)' : 'RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                                className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all shadow-inner"
                              />
                              <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                                <Shield className="w-5 h-5 text-hextech-gold" />
                              </div>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Default Region</label>
                            <div className="relative group/input">
                              <select
                                value={creds.DEFAULT_RIOT_REGION}
                                onChange={(e) => setCreds({...creds, DEFAULT_RIOT_REGION: e.target.value})}
                                className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all appearance-none cursor-pointer shadow-inner pr-12"
                              >
                                <option value="na1">North America (NA1)</option>
                                <option value="euw1">Europe West (EUW1)</option>
                                <option value="eun1">Europe Nordic & East (EUNE)</option>
                                <option value="kr">Korea (KR)</option>
                                <option value="jp1">Japan (JP1)</option>
                                <option value="br1">Brazil (BR1)</option>
                                <option value="la1">Latin America North (LA1)</option>
                                <option value="la2">Latin America South (LA2)</option>
                                <option value="oc1">Oceania (OC1)</option>
                                <option value="tr1">Turkey (TR1)</option>
                                <option value="ru">Russia (RU)</option>
                                <option value="ph2">Philippines (PH2)</option>
                                <option value="sg2">Singapore (SG2)</option>
                                <option value="th2">Thailand (TH2)</option>
                                <option value="tw2">Taiwan (TW2)</option>
                                <option value="vn2">Vietnam (VN2)</option>
                                <option value="me1">Middle East (ME1)</option>
                                <option value="pbe1">PBE (PBE1)</option>
                              </select>
                              <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                                <Globe className="w-5 h-5 text-hextech-gold" />
                              </div>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Gemini Key</label>
                            <div className="relative group/input">
                              <input
                                type="password"
                                value={creds.GEMINI_API_KEY}
                                onChange={(e) => setCreds({...creds, GEMINI_API_KEY: e.target.value})}
                                placeholder={botStatus?.config.hasGeminiKey ? '******** (Configured)' : 'AIzaSy...'}
                                className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all shadow-inner"
                              />
                              <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                                <Cpu className="w-5 h-5 text-hextech-gold" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
         </div>
                    </div>

                    <div className="pt-12 border-t border-hextech-gold/10 grid grid-cols-1 md:grid-cols-2 gap-12">
                      <div className="space-y-3">
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Dashboard Access Key</label>
                        <div className="relative group/input">
                          <input
                            type="password"
                            value={creds.ADMIN_PASSWORD}
                            onChange={(e) => setCreds({...creds, ADMIN_PASSWORD: e.target.value})}
                            placeholder={botStatus?.config.hasAdminPassword ? '******** (Configured)' : 'Set a dashboard password'}
                            className="w-full bg-black/60 border border-hextech-gold/20 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-hextech-cyan/30 focus:border-hextech-cyan transition-all shadow-inner"
                          />
                          <div className="absolute top-0 right-0 h-full flex items-center pr-5 pointer-events-none opacity-20 group-hover/input:opacity-40 transition-opacity">
                            <Lock className="w-5 h-5 text-hextech-gold" />
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col justify-end gap-4">
                        <div className="flex items-center justify-between px-1">
                          <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${saveStatus.includes('Failed') ? 'text-rose-400' : 'text-hextech-cyan'}`}>
                            {saveStatus}
                          </span>
                        </div>
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full flex items-center justify-center gap-3 bg-hextech-gold/10 hover:bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/30 py-4.5 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all hover:scale-[1.02] active:scale-[0.98] magic-glow disabled:opacity-50 disabled:cursor-not-allowed h-[52px]"
                        >
                          <Save className="w-5 h-5" />
                          {loading ? 'Synchronizing Uplink...' : 'Synchronize Registry'}
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="mt-16 pt-16 border-t border-hextech-gold/10">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                      <div>
                        <h3 className="text-[11px] font-black text-hextech-gold uppercase tracking-[0.3em] flex items-center gap-4">
                          <div className="w-12 h-[1px] bg-hextech-gold/30" />
                          System Maintenance
                        </h3>
                        <p className="text-[11px] text-slate-500 uppercase font-bold tracking-[0.2em] mt-2">Core package integrity check & version verification</p>
                      </div>
                      <button
                        onClick={handleCheckUpdates}
                        disabled={checkingUpdates}
                        className="bg-white/5 hover:bg-white/10 text-slate-300 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 disabled:opacity-50 border border-hextech-gold/10 hover:border-hextech-gold/30 shadow-sm"
                      >
                        <RefreshCw className={`w-4 h-4 ${checkingUpdates ? 'animate-spin' : ''}`} />
                        {checkingUpdates ? 'Scanning Registry...' : 'Scan for Updates'}
                      </button>
                    </div>

                    {updates && Object.keys(updates).length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                        {Object.entries(updates).map(([pkg, info]) => (
                          <div key={pkg} className="flex flex-col p-6 bg-black/40 rounded-3xl border border-hextech-gold/10 group hover:border-hextech-gold/30 transition-all relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-hextech-gold/10 group-hover:bg-hextech-gold/30 transition-colors" />
                            <span className="text-[11px] font-black text-slate-300 uppercase tracking-[0.2em] mb-4">{pkg}</span>
                            <div className="flex items-center justify-between">
                              <div className="text-[10px] font-mono font-bold flex items-center gap-4">
                                <span className="text-slate-600">{(info as any).current}</span>
                                <div className="w-6 h-[1px] bg-slate-800" />
                                <span className="text-hextech-cyan">{(info as any).latest}</span>
                              </div>
                              <div className="p-2 bg-hextech-cyan/10 rounded-lg border border-hextech-cyan/20">
                                <Zap className="w-3.5 h-3.5 text-hextech-cyan" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {updates && Object.keys(updates).length === 0 && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-8 bg-hextech-cyan/5 border border-hextech-cyan/20 rounded-3xl flex items-center gap-6 text-hextech-cyan shadow-[0_0_30px_rgba(0,255,255,0.05)] relative overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-hextech-cyan/5 blur-3xl -mr-16 -mt-16 rounded-full" />
                        <div className="p-3 bg-hextech-cyan/10 rounded-2xl border border-hextech-cyan/20">
                          <CheckCircle className="w-6 h-6" />
                        </div>
                        <div>
                          <span className="text-[11px] font-black uppercase tracking-[0.2em]">All core systems are operating at peak efficiency</span>
                          <p className="text-[10px] text-hextech-cyan/60 uppercase font-bold tracking-widest mt-1">Version integrity verified</p>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
      </main>

      <footer className="relative z-10 py-12 border-t border-hextech-gold/5 bg-black/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-6">
            <div className="w-16 h-[1px] bg-gradient-to-r from-transparent to-hextech-gold/20" />
            <div className="p-2 bg-hextech-gold/5 rounded-lg border border-hextech-gold/10">
              <Shield className="w-4 h-4 text-hextech-gold/40" />
            </div>
            <div className="w-16 h-[1px] bg-gradient-to-l from-transparent to-hextech-gold/20" />
          </div>
          <div className="text-center">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em] mb-1">
              Made by <span className="text-hextech-gold">LoRDtheReapeR</span>
            </p>
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em]">
              All rights reserved &copy; {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
