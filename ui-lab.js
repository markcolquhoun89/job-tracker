const seedJobs = [
  { id: "j1", premise: "12 Ridgeway Close",  type: "CBT", location: "Pole 14",        status: "pending", eta: "10:40", port: "Spl-8 P3",  risk: "low",  pay: 42 },
  { id: "j2", premise: "77 Hawthorn Ave",    type: "CSP", location: "External box",   status: "pending", eta: "11:05", port: "Spl-2 P1",  risk: "med",  pay: 44 },
  { id: "j3", premise: "5 Mayfield Road",    type: "ONT", location: "Hallway",         status: "done",    eta: "11:20", port: "Spl-11 P4", risk: "low",  pay: 55 },
  { id: "j4", premise: "18 Kingfisher Dr",   type: "CBT", location: "Pit C14",         status: "failed",  eta: "12:00", port: "Spl-4 P7",  risk: "high", pay: 20 },
  { id: "j5", premise: "9 Cedar Mews",       type: "CSP", location: "Flats block B",   status: "pending", eta: "12:25", port: "Spl-1 P2",  risk: "med",  pay: 55 },
  { id: "j6", premise: "20 Brookfield Way",  type: "ONT", location: "Living room",     status: "pending", eta: "13:10", port: "Spl-6 P5",  risk: "low",  pay: 42 }
];

const state = {
  jobs: [...seedJobs],
  view: "queue",
  motion: true,
  energy: 0.35,
  density: "regular",
  idlePack: "pulse",
  pointer: { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 },
  pointerDown: false
};

const els = {
  jobStream: document.getElementById("job-stream"),
  navChips: [...document.querySelectorAll(".nav-chip")],
  panels: [...document.querySelectorAll(".view-panel")],
  motionToggle: document.getElementById("motion-toggle"),
  shuffleBtn: document.getElementById("shuffle-jobs"),
  boostBtn: document.getElementById("boost-energy"),
  accent: document.getElementById("accent"),
  bgIntensity: document.getElementById("bg-intensity"),
  density: document.getElementById("density"),
  idlePack: document.getElementById("idle-pack"),
  toast: document.getElementById("toast"),
  kpiQueue: document.getElementById("kpi-queue"),
  kpiDone: document.getElementById("kpi-done"),
  kpiRisk: document.getElementById("kpi-risk"),
  kpiPay: document.getElementById("kpi-pay"),
  payFigure: document.getElementById("pay-figure"),
  payDetail: document.getElementById("pay-detail"),
  microBars: document.getElementById("micro-bars"),
  canvas: document.getElementById("lab-canvas")
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 1300);
}

function randomTime() {
  const hour = 9 + Math.floor(Math.random() * 7);
  const minute = Math.floor(Math.random() * 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function randomLocation(type) {
  if (type === "CBT") return ["Pole 4", "Pole 9", "Pit A3", "Pit C12", "Pole 17"][Math.floor(Math.random() * 5)];
  if (type === "CSP") return ["External box", "Side wall", "Flats block A", "Flats block B", "Front elevation"][Math.floor(Math.random() * 5)];
  return ["Hallway", "Living room", "Kitchen", "Flat 2", "Utility room"][Math.floor(Math.random() * 5)];
}

function randomPort() {
  const sp = Math.ceil(Math.random() * 12);
  const p = Math.ceil(Math.random() * 8);
  return `Spl-${sp} P${p}`;
}

function shuffledJobs() {
  const types = ["CBT", "CSP", "ONT"];
  const risks = ["low", "med", "high"];
  return [...state.jobs]
    .sort(() => Math.random() - 0.5)
    .map((job) => {
      const type = types[Math.floor(Math.random() * types.length)];
      return {
        ...job,
        type,
        location: randomLocation(type),
        port: randomPort(),
        eta: randomTime(),
        pay: Math.max(18, job.pay + Math.round((Math.random() - 0.5) * 12)),
        risk: risks[Math.floor(Math.random() * risks.length)]
      };
    });
}

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  els.navChips.forEach((chip) => chip.classList.toggle("active", chip.dataset.view === view));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
}

function setJobStatus(id, status) {
  const next = state.jobs.map((job) => {
    if (job.id !== id) return job;
    return { ...job, status };
  });
  state.jobs = next;
  state.energy = Math.min(1.6, state.energy + 0.25);
  if (navigator.vibrate) navigator.vibrate(10);
  renderAll();
  const changed = next.find((j) => j.id === id);
  showToast(`${changed ? changed.premise : id} → ${status}`);
}

const TYPE_LABELS = { CBT: "Pole / Pit", CSP: "Ext. Access", ONT: "Internal" };

function swipeTemplate(job) {
  const statusClass = job.status === "done" ? "done" : (job.status === "failed" ? "failed" : "pending");
  const typeKey = job.type.toLowerCase();
  return `
    <div class="swipe-wrap" data-job-id="${job.id}">
      <div class="action-rail">
        <div class="rail-left">
          <button class="rail-btn done" data-action="done">Complete</button>
          <button class="rail-btn int" data-action="pending">Reopen</button>
        </div>
        <div class="rail-right">
          <button class="rail-btn fail" data-action="failed">Fail</button>
        </div>
      </div>
      <article class="job-card" data-job-id="${job.id}">
        <div class="job-top">
          <span class="type-badge type-${typeKey}">${job.type}<em>${TYPE_LABELS[job.type] ?? ""}</em></span>
          <span class="job-status ${statusClass}">${job.status.toUpperCase()}</span>
        </div>
        <strong class="job-premise">${job.premise}</strong>
        <div class="job-bottom">
          <span>${job.eta}</span>
          <strong>GBP ${job.pay.toFixed(2)}</strong>
        </div>
        <div class="job-meta">
          <span>${job.location}</span>
          <span>${job.port}</span>
        </div>
      </article>
    </div>
  `;
}

function attachCardGestures(cardWrap) {
  const card = cardWrap.querySelector(".job-card");
  const jobId = card.dataset.jobId;
  let startX = 0;
  let currentX = 0;
  let dragging = false;

  const updateDrag = (x) => {
    const clamped = Math.max(-150, Math.min(150, x));
    card.style.setProperty("--drag", `${clamped}px`);
  };

  const resetDrag = () => {
    card.style.setProperty("--drag", "0px");
  };

  const onPointerDown = (event) => {
    dragging = true;
    startX = event.clientX;
    currentX = 0;
    card.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    currentX = event.clientX - startX;
    updateDrag(currentX);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    if (currentX > 110) {
      setJobStatus(jobId, "done");
    } else if (currentX < -110) {
      setJobStatus(jobId, "failed");
    }
    resetDrag();
  };

  card.addEventListener("pointerdown", onPointerDown);
  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", onPointerUp);
  card.addEventListener("pointercancel", onPointerUp);

  cardWrap.querySelectorAll(".rail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      setJobStatus(jobId, action);
    });
  });
}

function renderJobs() {
  els.jobStream.innerHTML = state.jobs.map(swipeTemplate).join("");
  [...els.jobStream.querySelectorAll(".swipe-wrap")].forEach(attachCardGestures);
}

function renderPayWeek() {
  const done = state.jobs.filter((j) => j.status === "done");
  const total = done.reduce((sum, j) => sum + j.pay, 0);
  els.payFigure.textContent = `GBP ${total.toFixed(2)}`;
  els.payDetail.textContent = `${done.length} jobs resolved this cycle`;

  const rows = [
    { label: "Mon", value: 42 },
    { label: "Tue", value: 58 },
    { label: "Wed", value: 69 },
    { label: "Thu", value: 51 },
    { label: "Fri", value: 76 }
  ];
  const maxVal = Math.max(...rows.map((r) => r.value));
  els.microBars.innerHTML = rows
    .map((row) => `
      <div class="micro-row">
        <span>${row.label}</span>
        <div class="micro-track"><div class="micro-fill" style="width:${(row.value / maxVal) * 100}%"></div></div>
        <b>${row.value}</b>
      </div>
    `)
    .join("");
}

function renderKpi() {
  const queue = state.jobs.filter((j) => j.status === "pending").length;
  const done = state.jobs.filter((j) => j.status === "done").length;
  const risk = state.jobs.filter((j) => j.risk === "high").length;
  const pay = state.jobs.reduce((sum, j) => sum + j.pay, 0);

  els.kpiQueue.textContent = String(queue);
  els.kpiDone.textContent = String(done);
  els.kpiRisk.textContent = String(risk);
  els.kpiPay.textContent = `GBP ${pay.toFixed(0)}`;
}

function renderAll() {
  renderKpi();
  renderJobs();
  renderPayWeek();
}

function attachScrollBounce() {
  const list = els.jobStream;
  let touchStart = 0;

  list.addEventListener("touchstart", (event) => {
    touchStart = event.touches[0].clientY;
  }, { passive: true });

  list.addEventListener("touchmove", (event) => {
    const y = event.touches[0].clientY;
    const delta = y - touchStart;
    const atTop = list.scrollTop <= 0;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;

    if ((atTop && delta > 0) || (atBottom && delta < 0)) {
      const shift = Math.max(-18, Math.min(18, delta * 0.18));
      list.style.transform = `translateY(${shift}px)`;
    }
  }, { passive: true });

  list.addEventListener("touchend", () => {
    list.style.transform = "translateY(0px)";
  }, { passive: true });
}

function startBackground() {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let nodes = [];
  let t = 0;

  function densityCount() {
    if (state.density === "dense") return 80;
    if (state.density === "low") return 34;
    return 54;
  }

  function resetNodes() {
    nodes = Array.from({ length: densityCount() }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      r: 1 + Math.random() * 2
    }));
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    resetNodes();
  }

  function drawBackground() {
    t += 0.014;
    state.energy = Math.max(0.28, state.energy * 0.994);

    const intensity = Number(els.bgIntensity.value) / 100;
    const hueShift = state.idlePack === "drift" ? Math.sin(t * 0.6) * 18 : 0;

    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 0.8;

    nodes.forEach((node) => {
      node.x += node.vx;
      node.y += node.vy;

      if (node.x < -20) node.x = width + 20;
      if (node.x > width + 20) node.x = -20;
      if (node.y < -20) node.y = height + 20;
      if (node.y > height + 20) node.y = -20;

      const dx = state.pointer.x - node.x;
      const dy = state.pointer.y - node.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 180) {
        node.vx -= dx * 0.00002;
        node.vy -= dy * 0.00002;
      }
    });

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 130) continue;
        const alpha = (1 - d / 130) * 0.28 * intensity * (1 + state.energy * 0.35);
        ctx.strokeStyle = `hsla(${210 + hueShift}, 100%, 70%, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    nodes.forEach((node) => {
      const wave = Math.sin((node.x + t * 90) * 0.01) * 0.65;
      const pulse = state.idlePack === "calm" ? 0.7 : (1 + Math.sin(t * 3 + node.x * 0.01) * 0.2);
      const radius = (node.r + wave) * pulse;
      ctx.fillStyle = `hsla(${208 + hueShift}, 100%, 72%, ${0.3 + state.energy * 0.22})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, Math.max(0.8, radius), 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(drawBackground);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(drawBackground);
}

els.navChips.forEach((chip) => {
  chip.addEventListener("click", () => setView(chip.dataset.view));
});

els.motionToggle.addEventListener("click", () => {
  state.motion = !state.motion;
  document.body.classList.toggle("motion-on", state.motion);
  els.motionToggle.textContent = state.motion ? "Motion On" : "Motion Off";
  showToast(state.motion ? "Motion enabled" : "Motion reduced");
});

els.shuffleBtn.addEventListener("click", () => {
  state.jobs = shuffledJobs();
  state.energy = Math.min(1.8, state.energy + 0.35);
  renderAll();
  showToast("Queue shuffled");
});

els.boostBtn.addEventListener("click", () => {
  state.energy = Math.min(2, state.energy + 0.55);
  showToast("Network pulse boosted");
});

els.accent.addEventListener("input", (event) => {
  document.documentElement.style.setProperty("--primary", event.target.value);
});

els.bgIntensity.addEventListener("input", (event) => {
  const value = Number(event.target.value);
  const bgLight = Math.max(5, Math.min(26, Math.round(value / 2.5)));
  document.documentElement.style.setProperty("--surface", `hsl(216 24% ${bgLight}%)`);
  document.documentElement.style.setProperty("--surface-2", `hsl(216 23% ${Math.max(8, bgLight - 4)}%)`);
});

els.density.addEventListener("change", (event) => {
  state.density = event.target.value;
  state.energy = Math.min(1.6, state.energy + 0.2);
  showToast(`Particle density: ${state.density}`);
});

els.idlePack.addEventListener("change", (event) => {
  state.idlePack = event.target.value;
  state.energy = Math.min(1.6, state.energy + 0.2);
  showToast(`Idle pack: ${state.idlePack}`);
});

window.addEventListener("pointermove", (event) => {
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
});

window.addEventListener("pointerdown", () => {
  state.pointerDown = true;
  state.energy = Math.min(1.8, state.energy + 0.25);
});

window.addEventListener("pointerup", () => {
  state.pointerDown = false;
});

attachScrollBounce();
renderAll();
startBackground();
