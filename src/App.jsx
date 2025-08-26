// src/App.js
import React, { useEffect, useState, useRef } from "react";
import "./index.css";

const API_URL = "https://example.com/api/projects"; // optional - replace with your real API
const STORAGE_KEY = "freelancer_bids_v1";
const BC_CHANNEL = "freelancer_bids_channel";

/* --------- Mock projects (fallback if fetch fails) --------- */
const mockProjects = [
  {
    id: "p1",
    title: "Build a React landing page",
    description: "Design and implement a responsive React landing page for a SaaS product.",
    category: "Web Development",
    budgetMin: 100,
    budgetMax: 300,
    bidClose: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // 1 hour
  },
  {
    id: "p2",
    title: "Mobile app UI/UX",
    description: "Create UI/UX screens for an Android/iOS shopping app.",
    category: "Design",
    budgetMin: 200,
    budgetMax: 500,
    bidClose: new Date(Date.now() + 1000 * 60 * 30).toISOString(), // 30 minutes
  },
  {
    id: "p3",
    title: "WordPress site customization",
    description: "Customize a WordPress theme and add custom widgets.",
    category: "Web Development",
    budgetMin: 80,
    budgetMax: 200,
    bidClose: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 1 day
  },
  {
    id: "p4",
    title: "SEO audit and optimizations",
    description: "Perform SEO audit and apply on-page optimizations.",
    category: "Marketing",
    budgetMin: 50,
    budgetMax: 150,
    bidClose: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // 10 minutes
  },
];

/* --------- Helpers for localStorage persistence --------- */
function readStoredBids() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse stored bids", e);
    return {};
  }
}
function writeStoredBids(bidsMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bidsMap));
  } catch (e) {
    console.error("Failed to write bids to localStorage", e);
  }
}
function formatCurrency(n) {
  return "₹" + Number(n).toLocaleString();
}

/* --------- Countdown component --------- */
function Countdown({ endTime, onExpire }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const end = new Date(endTime).getTime();
  const diff = Math.max(0, end - now);
  const sec = Math.floor(diff / 1000) % 60;
  const min = Math.floor(diff / 1000 / 60) % 60;
  const hrs = Math.floor(diff / 1000 / 60 / 60) % 24;
  const days = Math.floor(diff / 1000 / 60 / 60 / 24);

  useEffect(() => {
    if (diff === 0 && typeof onExpire === "function") onExpire();
  }, [diff, onExpire]);

  if (diff === 0) return <span className="countdown closed">Bidding closed</span>;

  return (
    <span className="countdown">
      {days > 0 ? `${days}d ` : ""}{hrs.toString().padStart(2, "0")}:{min.toString().padStart(2,"0")}:{sec.toString().padStart(2,"0")}
    </span>
  );
}

/* --------- Modal for placing bids --------- */
function BidModal({ project, onClose, onPlaceBid }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);

  const highest = project.highestBid ? project.highestBid.amount : 0;

  function submit(e) {
    e.preventDefault();
    setError(null);
    const num = Number(amount);
    if (!name.trim()) return setError("Enter your name");
    if (!num || num <= highest) return setError(`Bid must be greater than current highest (${formatCurrency(highest)})`);
    onPlaceBid({ bidder: name.trim(), amount: num, time: new Date().toISOString() });
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Place bid for: {project.title}</h3>
        <form onSubmit={submit}>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Amount (₹)
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn">Place Bid</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* --------- Main app --------- */
export default function App() {
  const [projects, setProjects] = useState([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const bcRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetch(API_URL)
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((data) => {
        if (!mounted) return;
        setProjects(data.map((p) => ({ ...p })));
      })
      .catch(() => {
        // fallback to local mock data
        setProjects(mockProjects.map((p) => ({ ...p })));
      });
    return () => (mounted = false);
  }, []);

  // load stored bids and attach to projects
  useEffect(() => {
    const stored = readStoredBids(); // { projectId: [bids...] }
    setProjects((prev) => prev.map((p) => {
      const bids = stored[p.id] || [];
      const highest = bids.reduce((acc, b) => (!acc || b.amount > acc.amount ? b : acc), null);
      return { ...p, bids, highestBid: highest };
    }));
  }, [/* run after initial projects set */]);

  // BroadcastChannel + storage fallback + custom event for same-tab updates
  useEffect(() => {
    if ("BroadcastChannel" in window) {
      try {
        bcRef.current = new BroadcastChannel(BC_CHANNEL);
        bcRef.current.onmessage = (ev) => {
          const msg = ev.data;
          if (msg?.type === "new-bid") {
            applyIncomingBid(msg.projectId, msg.bid, false);
          }
        };
      } catch (e) {
        console.warn("BroadcastChannel init failed", e);
      }
    }

    function onStorage(e) {
      if (e.key !== STORAGE_KEY) return;
      try {
        const newMap = JSON.parse(e.newValue || "{}");
        Object.keys(newMap).forEach((pid) => {
          const bids = newMap[pid] || [];
          const highest = bids.reduce((acc, b) => (!acc || b.amount > acc.amount ? b : acc), null);
          applyIncomingBid(pid, highest, true, bids);
        });
      } catch (err) {
        console.error("storage parse error", err);
      }
    }
    window.addEventListener("storage", onStorage);

    function onLocalBid(e) {
      const { projectId, bid } = e.detail || {};
      if (projectId && bid) applyIncomingBid(projectId, bid, true);
    }
    window.addEventListener("freelancerBid", onLocalBid);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("freelancerBid", onLocalBid);
      if (bcRef.current) {
        try { bcRef.current.close(); } catch(e) {}
      }
    };
  }, []);

  function applyIncomingBid(projectId, bid, fromStorage = false, fullBidsArray = null) {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== projectId) return p;
      const existingBids = fullBidsArray ?? (p.bids || []);
      let newBids = existingBids.slice();
      if (bid) {
        const already = newBids.find((b) => b.time === bid.time && b.bidder === bid.bidder && b.amount === bid.amount);
        if (!already) newBids = [...newBids, bid];
      }
      const highest = newBids.reduce((acc, b) => (!acc || b.amount > acc.amount ? b : acc), null);
      return { ...p, bids: newBids, highestBid: highest };
    }));
  }

  function placeBid(projectId, bid) {
    const map = readStoredBids();
    map[projectId] = map[projectId] || [];
    map[projectId].push(bid);
    writeStoredBids(map);

    // notify same tab listeners
    window.dispatchEvent(new CustomEvent("freelancerBid", { detail: { projectId, bid } }));
    // Broadcast to other tabs
    if (bcRef.current) {
      try {
        bcRef.current.postMessage({ type: "new-bid", projectId, bid });
      } catch (e) {
        console.warn("Broadcast post failed", e);
      }
    }

    // update local state immediately
    applyIncomingBid(projectId, bid, true);
  }

  const categories = ["All", ...Array.from(new Set(projects.map((p) => p.category))).filter(Boolean)];

  const filtered = projects.filter((p) => {
    if (filter !== "All" && p.category !== filter) return false;
    if (search.trim() && !`${p.title} ${p.description}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a,b)=> new Date(a.bidClose)-new Date(b.bidClose));

  return (
    <div className="app">
      <header>
        <h1>Freelancer Marketplace — Live Bids</h1>
        <div className="controls">
          <input placeholder="Search projects..." value={search} onChange={(e)=>setSearch(e.target.value)} />
          <select value={filter} onChange={(e)=>setFilter(e.target.value)}>
            {categories.map((c)=> <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </header>

      <main>
        {filtered.length === 0 ? <p>No projects found.</p> : (
          <div className="grid">
            {filtered.map((p) => (
              <div key={p.id} className="card">
                <h3>{p.title}</h3>
                <p className="category">{p.category}</p>
                <p className="desc">{p.description}</p>
                <p>Budget: {formatCurrency(p.budgetMin)} - {formatCurrency(p.budgetMax)}</p>
                <p>Highest bid: {p.highestBid ? formatCurrency(p.highestBid.amount) + ` by ${p.highestBid.bidder}` : "No bids yet"}</p>
                <Countdown endTime={p.bidClose} onExpire={()=>{ /* optional */ }} />
                <div className="actions">
                  <button className="btn" disabled={new Date(p.bidClose).getTime() <= Date.now()} onClick={()=>setSelectedProject(p)}>Place Bid</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {selectedProject && (
        <BidModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onPlaceBid={(bid) => placeBid(selectedProject.id, bid)}
        />
      )}

      <footer>
        <small>Local mock bids — synced across tabs using BroadcastChannel / storage events. Bids persist in localStorage.</small>
      </footer>
    </div>
  );
}
