import React, { useState, useEffect } from 'react';
import { 
  Instagram, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Layout, 
  Settings, 
  History, 
  Send, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  Cpu,
  LogIn,
  LogOut,
  User as UserIcon,
  ShieldCheck
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  where,
  limit,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from './lib/firebase';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface Profile {
  id: string;
  handle: string;
  addedAt: any;
}

interface PostDraft {
  topic: string;
  caption: string;
  imagePrompt: string;
  strategy: string;
  hashtags: string[];
}

interface Post {
  id: string;
  topic: string;
  caption: string;
  status: 'draft' | 'scheduled' | 'posted';
  createdAt: any;
  scheduledAt?: any;
  imageUrl?: string;
  hashtags?: string[];
}

interface SettingsData {
  myHandle: string;
  tone: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'profiles' | 'settings'>('dashboard');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [settings, setSettings] = useState<SettingsData>({ myHandle: '', tone: 'Professional' });
  const [newHandle, setNewHandle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [drafts, setDrafts] = useState<PostDraft[]>([]);
  const [lastResearchDate, setLastResearchDate] = useState<any>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);

  // Cooldown timer
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfiles([]);
      setPosts([]);
      return;
    }

    // Listen to settings
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data() as SettingsData);
      }
    });

    // Listen to profiles
    const qProfiles = query(
      collection(db, 'profiles'), 
      where('userId', '==', user.uid),
      orderBy('addedAt', 'desc')
    );
    const unsubscribeProfiles = onSnapshot(qProfiles, (snapshot) => {
      setProfiles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Profile)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'profiles'));

    // Listen to posts
    const qPosts = query(
      collection(db, 'posts'), 
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribePosts = onSnapshot(qPosts, (snapshot) => {
      setPosts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'posts'));

    // Listen to research
    const qResearch = query(
      collection(db, 'research'),
      where('userId', '==', user.uid),
      orderBy('analyzedAt', 'desc'),
      limit(1)
    );
    const unsubscribeResearch = onSnapshot(qResearch, (snapshot) => {
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        setDrafts(data.suggestions || []);
        setLastResearchDate(data.analyzedAt);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, 'research'));

    return () => {
      unsubscribeSettings();
      unsubscribeProfiles();
      unsubscribePosts();
      unsubscribeResearch();
    };
  }, [user]);

  // Auto-Post Agent Simulator
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const nextToPost = posts.find(p => p.status === 'scheduled' && p.scheduledAt?.toDate?.() <= now);
      if (nextToPost) {
        postNow(nextToPost);
      }
    }, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [posts]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const logout = () => signOut(auth);

  const addProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHandle.trim()) return;
    const handle = newHandle.trim().startsWith('@') ? newHandle.trim() : `@${newHandle.trim()}`;
    try {
      await addDoc(collection(db, 'profiles'), {
        handle,
        addedAt: serverTimestamp(),
        userId: user.uid
      });
      setNewHandle('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'profiles');
    }
  };

  const removeProfile = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'profiles', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'profiles');
    }
  };

  const generatePostDrafts = async () => {
    if (profiles.length === 0) {
      setActiveStatus("Add reference profiles first!");
      return;
    }
    setIsGenerating(true);
    setActiveStatus("AI is analyzing viral content styles...");
    try {
      const response = await fetch('/api/discover-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          profiles: profiles.map(p => p.handle),
          myHandle: settings.myHandle 
        })
      });
      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 429) {
          setCooldownSeconds(60);
        }
        throw new Error(data.error || "Synthesis failed");
      }

      if (Array.isArray(data)) {
        setDrafts(data);
        setActiveStatus("Insights synthesized. Ready for review.");
        
        // Persist research results
        await addDoc(collection(db, 'research'), {
          suggestions: data,
          analyzedAt: serverTimestamp(),
          userId: user.uid
        });
      } else {
        throw new Error("Invalid response format from agent");
      }
    } catch (err: any) {
      console.error(err);
      setActiveStatus(err.message || "Failed to analyze trends.");
    } finally {
      setIsGenerating(false);
    }
  };

  const saveToDrafts = async (draft: PostDraft) => {
    try {
      await addDoc(collection(db, 'posts'), {
        ...draft,
        status: 'draft',
        createdAt: serverTimestamp(),
        userId: user.uid
      });
      setActiveStatus("Post idea saved to dashboard.");
      setDrafts(prev => prev.filter(d => d.topic !== draft.topic));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'posts');
    }
  };

  const schedulePost = async (post: Post, dateStr: string) => {
    if (!dateStr) return;
    try {
      const scheduledAt = new Date(dateStr);
      await updateDoc(doc(db, 'posts', post.id), {
        status: 'scheduled',
        scheduledAt
      });
      setActiveStatus(`Post scheduled for ${scheduledAt.toLocaleString()}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'posts');
    }
  };

  const postNow = async (post: Post) => {
    setActiveStatus("Simulating Instagram posting...");
    try {
      const response = await fetch('/api/instagram/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: post.caption })
      });
      const data = await response.json();
      if (data.success) {
        await updateDoc(doc(db, 'posts', post.id), {
          status: 'posted',
          postedAt: serverTimestamp()
        });
        setActiveStatus("Successfully posted to Instagram!");
      }
    } catch (err) {
      console.error(err);
      setActiveStatus("Posting failed simulation.");
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen w-full bg-dash-bg flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full bg-dash-bg flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bento-card flex flex-col items-center text-center gap-6"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-xl">
            <Instagram className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">InstaAgent AI</h1>
            <p className="text-zinc-500 text-sm">Sign in to start discovering viral trends and automating your content pipeline.</p>
          </div>
          <button 
            onClick={login}
            className="w-full flex items-center justify-center gap-3 py-4 bg-white text-zinc-900 rounded-2xl font-bold hover:bg-zinc-100 transition-all shadow-lg active:scale-[0.98]"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
          <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">Secure auth via Firebase</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-dash-bg text-dash-ink p-4 md:p-6 overflow-hidden flex flex-col gap-4">
      {/* Header Section */}
      <header className="flex items-center justify-between bg-zinc-900/50 border border-dash-line p-4 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center">
            <Cpu className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">InstaAgent AI</h1>
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">{user.displayName || 'Agent Active'}</p>
              {settings.myHandle && (
                <span className="text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/30 font-bold uppercase tracking-tighter">
                  Targeting {settings.myHandle}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button onClick={logout} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-500 hover:text-zinc-300">
             <LogOut className="w-4 h-4" />
          </button>
          {activeStatus && (
            <div className="hidden lg:flex items-center gap-2 bg-indigo-500/10 px-3 py-1.5 rounded-full border border-indigo-500/20">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
              <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest">{activeStatus}</span>
            </div>
          )}
          <nav className="flex bg-zinc-800/50 rounded-xl p-1 border border-dash-line">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: Layout },
              { id: 'profiles', label: 'Profiles', icon: Instagram },
              { id: 'history', label: 'History', icon: History },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                  activeTab === tab.id ? "bg-zinc-100 text-zinc-900 shadow-lg" : "text-zinc-400 hover:text-white"
                )}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="h-full grid grid-cols-12 grid-rows-6 gap-4"
            >
              {/* Reference Profiles Quick View */}
              <section className="col-span-12 lg:col-span-4 row-span-3 bento-card flex flex-col gap-4 overflow-hidden">
                <div className="flex justify-between items-center">
                  <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Reference Context</h2>
                  <button onClick={() => setActiveTab('profiles')} className="text-indigo-400 text-[10px] font-bold uppercase hover:underline">+ Manage</button>
                </div>
                <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
                  {profiles.length > 0 ? profiles.map(p => (
                    <div key={p.id} className="data-row">
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-dash-line">
                         <Instagram className="w-4 h-4 opacity-40" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{p.handle}</p>
                        <p className="text-[10px] text-zinc-500 font-mono italic">Connected</p>
                      </div>
                    </div>
                  )) : (
                    <div className="flex-1 flex items-center justify-center opacity-20 italic text-xs">No profiles added</div>
                  )}
                </div>
                <div className="mt-auto p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                  <p className="text-[10px] text-indigo-300 leading-relaxed font-mono">
                    System scanning {profiles.length} profiles for latent virality markers.
                  </p>
                </div>
              </section>

              {/* Main Generation Area */}
              <section className="col-span-12 lg:col-span-8 row-span-4 bento-card flex flex-col gap-6 overflow-hidden">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-bold">Content Pipeline</h2>
                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">
                      {lastResearchDate ? `Last Synced: ${lastResearchDate.toDate?.()?.toLocaleString()}` : "Simulated Posting Queue"}
                    </p>
                  </div>
                  <button 
                    onClick={generatePostDrafts}
                    disabled={isGenerating || profiles.length === 0 || cooldownSeconds > 0}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-xl text-xs font-bold hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2 transition-all active:scale-95 min-w-[140px] justify-center"
                  >
                    {isGenerating ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : cooldownSeconds > 0 ? (
                      <span className="font-mono text-[10px]">{cooldownSeconds}s</span>
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    <span>{isGenerating ? "AI ANALYZING..." : cooldownSeconds > 0 ? "AI COOLING DOWN" : "TRIGGER AI SCAN"}</span>
                  </button>
                </div>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 overflow-y-auto pr-2 custom-scrollbar">
                  {drafts.length > 0 ? drafts.map((draft, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20, delay: idx * 0.1 }}
                      className="bg-zinc-800/40 border border-indigo-500/20 rounded-2xl p-4 flex flex-col gap-3 group h-fit shadow-lg shadow-indigo-500/5"
                    >
                      <div className="aspect-square bg-zinc-800/50 rounded-xl flex items-center justify-center relative overflow-hidden">
                        <TrendingUp className="w-8 h-8 opacity-10" />
                        <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] font-bold text-indigo-400">IDEA 0{idx+1}</div>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xs font-bold uppercase tracking-tight mb-2 line-clamp-1">{draft.topic}</h3>
                        <p className="text-[10px] leading-relaxed text-zinc-400 italic line-clamp-3 mb-2">"{draft.caption}"</p>
                        <div className="flex flex-wrap gap-1">
                          {draft.hashtags?.slice(0, 5).map((tag, i) => (
                            <span key={i} className="text-[8px] text-indigo-400 opacity-60 font-mono italic">#{tag.replace('#', '')}</span>
                          ))}
                          {draft.hashtags?.length > 5 && <span className="text-[8px] text-zinc-500 opacity-60">+{draft.hashtags.length - 5} more</span>}
                        </div>
                      </div>
                      <button 
                        onClick={() => saveToDrafts(draft)}
                        className="w-full py-2.5 bg-indigo-600/10 border border-indigo-600/30 text-indigo-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-all"
                      >
                        Capture Idea
                      </button>
                    </motion.div>
                  )) : (
                    <div className="col-span-3 flex flex-col items-center justify-center opacity-10 gap-2 border border-dashed border-dash-line rounded-2xl">
                       <Layout className="w-12 h-12" />
                       <span className="text-[10px] font-mono uppercase tracking-widest">Pipeline Empty</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Trend Radar */}
              <section className="col-span-12 lg:col-span-4 row-span-3 bento-card flex flex-col gap-4">
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Trend Radar</h2>
                <div className="flex-1 flex flex-col gap-4">
                  <div className="space-y-4">
                    {[
                      { l: 'Bento UI Trends', v: 85, d: '+44%' },
                      { l: 'AI Agency Growth', v: 62, d: '+28%' },
                      { l: 'Minimalist Content', v: 30, d: '+12%' },
                    ].map((t, i) => (
                      <div key={i} className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-mono">
                          <span>{t.l}</span>
                          <span className="text-indigo-400">{t.d}</span>
                        </div>
                        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${t.v}%` }}
                            className="h-full bg-indigo-500"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-20 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 flex flex-col items-center justify-center p-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                   <p className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.2em] relative z-10">Viral Window Active</p>
                   <p className="text-zinc-500 text-[8px] font-mono uppercase mt-1">18:00 - 20:00 PST</p>
                </div>
              </section>

              {/* System Terminal / Queue */}
              <section className="col-span-12 lg:col-span-8 row-span-2 bg-black border border-dash-line rounded-3xl p-5 font-mono text-[11px] text-zinc-500 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between mb-4 border-b border-dash-line pb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-zinc-200 text-[10px] font-bold uppercase tracking-widest">Active Queue</span>
                  </div>
                  <div className="flex gap-4 text-[9px] uppercase">
                     <span>Pending: {posts.filter(p=>p.status!=='posted').length}</span>
                     <span>Posted: {posts.filter(p=>p.status==='posted').length}</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
                  {posts.filter(p => p.status === 'scheduled').length > 0 && (
                    <div className="mb-4">
                      <p className="text-[9px] text-indigo-400 font-black uppercase mb-2">Upcoming Schedule</p>
                      <div className="space-y-2">
                        {posts.filter(p => p.status === 'scheduled').sort((a,b) => a.scheduledAt?.toDate?.() - b.scheduledAt?.toDate?.()).map(post => (
                          <div key={post.id} className="bg-indigo-500/5 border border-indigo-500/20 p-3 rounded-xl flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="text-[10px] text-zinc-300 font-bold truncate w-48">{post.topic}</span>
                              <span className="text-[8px] text-indigo-400 font-mono italic">
                                {post.scheduledAt?.toDate?.()?.toLocaleString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                              <button 
                                onClick={() => postNow(post)}
                                className="bg-zinc-800 text-zinc-400 p-1.5 rounded hover:bg-white hover:text-black transition-all"
                              >
                                <Send className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {posts.filter(p => p.status === 'draft').length > 0 && (
                    <div>
                      <p className="text-[9px] text-zinc-500 font-black uppercase mb-2">Unscheduled Drafts</p>
                      <div className="space-y-2">
                        {posts.filter(p => p.status === 'draft').map((post) => (
                          <div key={post.id} className="flex flex-col gap-2 group hover:bg-zinc-900 p-2 rounded transition-colors border border-transparent hover:border-zinc-800">
                            <div className="flex items-center justify-between font-mono">
                              <div className="flex items-center gap-3">
                                <span className="text-zinc-600">[{post.createdAt?.toDate?.()?.toLocaleTimeString() || '00:00:00'}]</span>
                                <span className="text-zinc-300 truncate w-48 md:w-64">{post.topic}</span>
                              </div>
                              <button 
                                 onClick={() => postNow(post)}
                                 className="bg-zinc-800 text-zinc-400 p-1.5 rounded hover:bg-zinc-100 hover:text-zinc-900 transition-all opacity-0 group-hover:opacity-100"
                               >
                                 <Send className="w-3 h-3" />
                               </button>
                            </div>
                            <div className="flex items-center gap-2 pl-24">
                               <span className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest">Schedule:</span>
                               <input 
                                 type="datetime-local" 
                                 className="bg-zinc-800 text-[10px] text-zinc-300 border-none rounded px-2 py-0.5 focus:outline-none"
                                 onChange={(e) => schedulePost(post, e.target.value)}
                               />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {posts.filter(p => p.status !== 'posted').length === 0 && (
                    <p className="text-center py-4 text-zinc-700 italic">No operations in queue.</p>
                  )}
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'profiles' && (
            <motion.div 
              key="profiles"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="h-full max-w-2xl mx-auto bento-card flex flex-col gap-6"
            >
              <div>
                <h2 className="text-2xl font-bold mb-1">Target Scrapers</h2>
                <p className="text-xs text-zinc-500 uppercase font-mono">Reference point for agent discovery</p>
              </div>
              
              <form onSubmit={addProfile} className="flex gap-4 bg-zinc-800/50 p-4 rounded-2xl border border-dash-line">
                <input 
                  type="text" 
                  value={newHandle}
                  onChange={(e) => setNewHandle(e.target.value)}
                  placeholder="Instagram @handle" 
                  className="flex-1 bg-transparent border-none font-mono text-sm focus:outline-none placeholder:opacity-30"
                />
                <button type="submit" className="bg-zinc-100 text-zinc-900 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-white transition-all shadow-lg active:scale-95 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Add Profile
                </button>
              </form>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                {profiles.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-4 bg-zinc-800/30 border border-dash-line rounded-2xl group hover:border-zinc-500 transition-all">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 bg-zinc-700 rounded-full flex items-center justify-center border border-dash-line">
                         <Instagram className="w-5 h-5 opacity-50" />
                       </div>
                       <div>
                         <p className="font-bold text-lg">{p.handle}</p>
                         <p className="text-[10px] text-zinc-500 font-mono uppercase">{p.addedAt?.toDate?.()?.toLocaleDateString()}</p>
                       </div>
                    </div>
                    <button 
                      onClick={() => removeProfile(p.id)}
                      className="p-2 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              className="h-full bento-card flex flex-col gap-6"
            >
              <div>
                <h2 className="text-2xl font-bold mb-1">Operational History</h2>
                <p className="text-xs text-zinc-500 uppercase font-mono tracking-widest">Successfully deployed content assets</p>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <table className="w-full text-left font-mono text-[11px] border-separate border-spacing-y-2">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-dash-line">
                    <tr>
                      <th className="p-4 opacity-40 font-normal">TIMESTAMP</th>
                      <th className="p-4 opacity-40 font-normal">TOPIC</th>
                      <th className="p-4 opacity-40 font-normal">STATUS</th>
                      <th className="p-4 opacity-40 font-normal text-right">METRIC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posts.filter(p => p.status === 'posted').map((post) => (
                      <tr key={post.id} className="bg-zinc-800/30 border border-dash-line hover:bg-zinc-800 transition-all border-none">
                        <td className="p-4 rounded-l-2xl border-l border-t border-b border-dash-line">{post.createdAt?.toDate?.()?.toLocaleDateString()}</td>
                        <td className="p-4 font-bold border-t border-b border-dash-line">{post.topic}</td>
                        <td className="p-4 border-t border-b border-dash-line">
                           <span className="px-2 py-0.5 rounded border border-green-500/20 text-green-500 bg-green-500/5">DEPLOYED</span>
                        </td>
                        <td className="p-4 text-right rounded-r-2xl border-r border-t border-b border-dash-line">
                           <span className="text-indigo-400 font-black">+ LIVE</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {posts.filter(p => p.status === 'posted').length === 0 && (
                   <div className="flex flex-col items-center justify-center py-24 opacity-20 italic">
                     <History className="w-12 h-12 mb-2" />
                     <p className="text-xs uppercase tracking-widest font-mono">No historical data available</p>
                   </div>
                )}
              </div>
            </motion.div>
          )}
          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="h-full max-w-xl mx-auto bento-card flex flex-col gap-8"
            >
              <div className="flex items-center gap-4 border-b border-dash-line pb-6">
                <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center border border-dash-line">
                  <UserIcon className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Account Intelligence</h2>
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Personalize your AI Agent</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black tracking-[0.2em] text-zinc-500">My Instagram Handle</label>
                  <input 
                    type="text" 
                    value={settings.myHandle}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings(prev => ({ ...prev, myHandle: val }));
                      setDoc(doc(db, 'settings', user!.uid), { myHandle: val, updatedAt: serverTimestamp() }, { merge: true });
                    }}
                    placeholder="@your_account"
                    className="w-full bg-zinc-800/50 border border-dash-line rounded-xl p-4 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                  <p className="text-[9px] text-zinc-600 italic">This helps the AI understand your brand voice and target audience.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black tracking-[0.2em] text-zinc-500">AI Personality</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Professional', 'Witty', 'Hype', 'Educational'].map(tone => (
                      <button 
                        key={tone}
                        onClick={() => {
                          setSettings(prev => ({ ...prev, tone }));
                          setDoc(doc(db, 'settings', user!.uid), { tone, updatedAt: serverTimestamp() }, { merge: true });
                        }}
                        className={cn(
                          "py-3 px-4 rounded-xl text-xs font-bold border transition-all",
                          settings.tone === tone ? "bg-indigo-500/10 border-indigo-500 text-indigo-400" : "bg-zinc-900 border-dash-line text-zinc-500 hover:border-zinc-700"
                        )}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-auto p-4 bg-zinc-900 rounded-2xl border border-dash-line flex items-center gap-4">
                 <ShieldCheck className="w-5 h-5 text-green-500" />
                 <div className="text-[10px] text-zinc-500 leading-tight">
                    Your data is stored securely in Firebase. Instagram posting is currently simulated via our testing sandbox.
                 </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

