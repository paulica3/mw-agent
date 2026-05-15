/* =============================================================
   XPERIMENT_AI / client fx + interactions
   ============================================================= */

(() => {
    "use strict";

    /* ---------- THEME TOGGLE ---------- */
    const root = document.documentElement;
    const themeBtn = document.getElementById("themeToggle");
    const themeMeta = document.getElementById("themeColorMeta");
    const THEME_KEY = "xa-theme";

    let currentSparkle = "255, 255, 255";
    const readSparkle = () => {
        const v = getComputedStyle(root).getPropertyValue("--sparkle-rgb").trim();
        if (v) currentSparkle = v;
    };

    const applyTheme = (theme, animate = true) => {
        root.setAttribute("data-theme", theme);
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
        // cookie → so server renders the right data-theme on next navigation
        document.cookie = `xa-theme=${theme}; path=/; max-age=31536000; samesite=lax`;
        if (themeMeta) themeMeta.setAttribute("content", theme === "bloom" ? "#f1e9da" : "#050505");
        readSparkle();

        if (animate) {
            const burstX = themeBtn ? themeBtn.getBoundingClientRect().left + 40 : window.innerWidth / 2;
            const burstY = themeBtn ? themeBtn.getBoundingClientRect().top + 14  : window.innerHeight / 2;
            window.dispatchEvent(new CustomEvent("xa-burst", { detail: { x: burstX, y: burstY, count: 18 } }));
        }
    };

    // initial sparkle read (theme was set server-side in <html data-theme>)
    readSparkle();

    if (themeBtn) {
        themeBtn.addEventListener("click", () => {
            const next = root.getAttribute("data-theme") === "bloom" ? "chaos" : "bloom";
            applyTheme(next, true);
        });
    }

    // cross-tab sync: if another tab toggles, follow along
    window.addEventListener("storage", (e) => {
        if (e.key === THEME_KEY && e.newValue && e.newValue !== root.getAttribute("data-theme")) {
            applyTheme(e.newValue, false);
        }
    });

    /* ---------- AUTO-HIDE NAV ----------
       nav is visible only when:
         - near the top of the page (first 80px of scroll)
         - cursor is in the top hover zone of the viewport
         - cursor is over the nav itself
       any other state → hide                                       */
    const navEl = document.querySelector(".nav");
    if (navEl) {
        /* expose actual nav height as a CSS var so .main can pad-top correctly.
           the nav wraps to 2 rows on small screens, fonts load async, and the
           bloom theme uses different typography — all change the height. */
        const measureNav = () => {
            if (!navEl.classList.contains("nav--hidden")) {
                const h = navEl.offsetHeight;
                if (h > 0) document.documentElement.style.setProperty("--nav-h", h + "px");
            }
        };
        measureNav();
        window.addEventListener("resize", measureNav, { passive: true });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureNav);
        // re-measure on theme toggle (different fonts → different height)
        new MutationObserver(measureNav).observe(document.documentElement, {
            attributes: true, attributeFilter: ["data-theme"]
        });

        const SHOW_AT_TOP = 80;     // px from page top where nav is always shown
        const HOVER_ZONE  = 72;     // px from viewport top that re-shows nav
        let hovering = false;
        let nearTop = true;         // assume cursor near top on load until proven otherwise

        const update = () => {
            const aboveThreshold = window.scrollY < SHOW_AT_TOP;
            const shouldShow = aboveThreshold || hovering || nearTop;
            navEl.classList.toggle("nav--hidden", !shouldShow);
        };

        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("mousemove", (e) => {
            const wasNear = nearTop;
            nearTop = e.clientY < HOVER_ZONE;
            if (wasNear !== nearTop) update();
        }, { passive: true });
        navEl.addEventListener("mouseenter", () => { hovering = true;  update(); });
        navEl.addEventListener("mouseleave", () => { hovering = false; update(); });
    }

    /* ---------- NOISE CANVAS ---------- */
    const noise = document.getElementById("fx-noise");
    if (noise) {
        const ctx = noise.getContext("2d");
        let w, h;
        const resize = () => {
            w = noise.width = Math.floor(window.innerWidth / 2);
            h = noise.height = Math.floor(window.innerHeight / 2);
        };
        resize();
        window.addEventListener("resize", resize);

        const render = () => {
            const img = ctx.createImageData(w, h);
            const buf = img.data;
            for (let i = 0; i < buf.length; i += 4) {
                const v = (Math.random() * 255) | 0;
                buf[i] = v;
                buf[i + 1] = v;
                buf[i + 2] = v;
                buf[i + 3] = 255;
            }
            ctx.putImageData(img, 0, 0);
        };

        let last = 0;
        const loop = (t) => {
            if (t - last > 60) {
                render();
                last = t;
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    /* ---------- STAR CURSOR + SPARKLE TRAIL ---------- */
    const starEl = document.getElementById("cursorStar");
    const trailCanvas = document.getElementById("sparkle-trail");
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;

    if (starEl && trailCanvas && hasFinePointer) {
        const ctx2 = trailCanvas.getContext("2d");
        let cw, ch;
        const resizeTrail = () => {
            cw = trailCanvas.width = window.innerWidth;
            ch = trailCanvas.height = window.innerHeight;
        };
        resizeTrail();
        window.addEventListener("resize", resizeTrail);

        let mx = -200, my = -200;
        let sx = -200, sy = -200;

        window.addEventListener("mousemove", (e) => {
            mx = e.clientX;
            my = e.clientY;
        });

        /* sparkle particles */
        const particles = [];
        let lastSpawn = 0;

        const spawnSparkle = (x, y) => {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 18;
            particles.push({
                x: x + Math.cos(angle) * dist,
                y: y + Math.sin(angle) * dist,
                size: 1 + Math.random() * 4.5,
                alpha: 0.9 + Math.random() * 0.1,
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.12,
                decay: 0.012 + Math.random() * 0.018,
                scale: 0.1,
                growing: true,
                maxScale: 0.6 + Math.random() * 0.8,
            });
        };

        /* draw a 4-pointed star centered at (0,0) */
        const drawStar4 = (ctx, size, rot) => {
            const outer = size;
            const inner = size * 0.22;
            const pts = 4;
            ctx.beginPath();
            for (let i = 0; i < pts * 2; i++) {
                const r = i % 2 === 0 ? outer : inner;
                const a = (i * Math.PI) / pts + rot;
                i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
                        : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            ctx.closePath();
        };

        const renderTrail = (now) => {
            ctx2.clearRect(0, 0, cw, ch);

            /* spawn on move */
            if (now - lastSpawn > 28) {
                const dx = mx - sx, dy = my - sy;
                if (dx * dx + dy * dy > 4) {
                    spawnSparkle(mx, my);
                    if (Math.random() > 0.55) spawnSparkle(mx, my);
                    lastSpawn = now;
                }
            }
            sx = mx; sy = my;

            /* update + draw particles */
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                if (p.growing) {
                    p.scale += 0.06;
                    if (p.scale >= p.maxScale) p.growing = false;
                } else {
                    p.alpha -= p.decay;
                }
                p.rot += p.rotSpeed;
                if (p.alpha <= 0) { particles.splice(i, 1); continue; }

                ctx2.save();
                ctx2.translate(p.x, p.y);
                ctx2.rotate(p.rot);
                ctx2.globalAlpha = p.alpha;

                /* outer glow */
                const grd = ctx2.createRadialGradient(0, 0, 0, 0, 0, p.size * p.scale * 2.5);
                grd.addColorStop(0, `rgba(${currentSparkle}, 0.6)`);
                grd.addColorStop(1, `rgba(${currentSparkle}, 0)`);
                ctx2.fillStyle = grd;
                ctx2.beginPath();
                ctx2.arc(0, 0, p.size * p.scale * 2.5, 0, Math.PI * 2);
                ctx2.fill();

                /* sharp star */
                drawStar4(ctx2, p.size * p.scale, 0);
                ctx2.fillStyle = `rgba(${currentSparkle}, 0.95)`;
                ctx2.fill();

                ctx2.restore();
            }

            requestAnimationFrame(renderTrail);
        };
        requestAnimationFrame(renderTrail);

        /* star element follow — lag-eased */
        let ex = -200, ey = -200;
        const moveStar = () => {
            ex += (mx - ex) * 0.22;
            ey += (my - ey) * 0.22;
            starEl.style.left = ex + "px";
            starEl.style.top  = ey + "px";
            requestAnimationFrame(moveStar);
        };
        moveStar();

        /* hot state on interactive elements */
        const hotSel = "a, button, .chip, .dropzone, .portal, .generate, .director";
        document.addEventListener("mouseover", (e) => {
            if (e.target.closest(hotSel)) {
                document.body.classList.add("cursor-hot");
                for (let i = 0; i < 5; i++) spawnSparkle(mx, my);
            }
        });
        document.addEventListener("mouseout", (e) => {
            if (e.target.closest(hotSel)) document.body.classList.remove("cursor-hot");
        });

        /* click burst */
        document.addEventListener("click", () => {
            for (let i = 0; i < 12; i++) spawnSparkle(mx, my);
        });

        /* theme-toggle burst */
        window.addEventListener("xa-burst", (e) => {
            const { x, y, count } = e.detail || {};
            if (typeof x !== "number" || typeof y !== "number") return;
            for (let i = 0; i < (count || 12); i++) spawnSparkle(x, y);
        });
    }

    /* ---------- CLOCK ---------- */
    const clock = document.getElementById("navClock");
    if (clock) {
        const pad = (n) => String(n).padStart(2, "0");
        const tick = () => {
            const d = new Date();
            clock.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
        };
        tick();
        setInterval(tick, 1000);
    }

    /* ---------- RANDOM GLITCH BURSTS ---------- */
    const glitchTargets = document.querySelectorAll(".glitch");
    setInterval(() => {
        if (Math.random() > 0.7) {
            const el = glitchTargets[Math.floor(Math.random() * glitchTargets.length)];
            if (!el) return;
            el.style.transform = `translateX(${(Math.random() - 0.5) * 6}px) skewX(${(Math.random() - 0.5) * 4}deg)`;
            setTimeout(() => { el.style.transform = ""; }, 80 + Math.random() * 120);
        }
    }, 2200);

    /* ---------- CHIP STORE ----------
       chips and categories live in Vercel KV, fetched via /api/chips.
       cached in localStorage for instant first paint; the API response
       reconciles when it arrives. color/duration are special groups
       hardcoded in HTML — their fragments live in STATIC_FRAGMENTS.        */
    const API_URL          = "/api/chips";
    const CACHE_KEY        = "xa-chips-cache";
    const STATIC_GROUPS    = ["color", "duration"];
    const PAGE             = document.body.classList.contains("page-dashboard") ? "dashboard"
                           : document.body.classList.contains("page-image")     ? "image"
                           : document.body.classList.contains("page-video")     ? "video"
                           : null;

    // fragments for the special hardcoded groups (color swatches, duration numerics)
    const STATIC_FRAGMENTS = {
        color: {
            cold_blue:     "cold blue color grade",
            warm_golden:   "warm golden hour grade",
            desaturated:   "desaturated near-monochrome",
            high_contrast: "high contrast punchy grade",
        },
        duration: {
            "2": "2s clip", "4": "4s clip", "8": "8s clip", "12": "12s clip",
        },
    };

    const slugify = (s) => (s || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

    const escapeHTML = (s) => (s || "")
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    /* in-memory copy of the entire config; one source of truth on the page. */
    let CONFIG = { categories: [] };

    const cacheRead = () => {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return null;
    };
    const cacheWrite = (cfg) => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cfg)); } catch (e) {}
    };

    const apiGet = async () => {
        const r = await fetch(API_URL, { headers: { "Accept": "application/json" } });
        if (!r.ok) throw new Error(`GET ${API_URL} -> ${r.status}`);
        return r.json();
    };
    const apiPut = async (cfg) => {
        const r = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cfg),
        });
        if (!r.ok) throw new Error(`POST ${API_URL} -> ${r.status}`);
        return r.json();
    };
    const apiReset = async () => {
        const r = await fetch(API_URL, { method: "DELETE" });
        if (!r.ok) throw new Error(`DELETE ${API_URL} -> ${r.status}`);
        return r.json();
    };

    /* debounced save: edits feel instant; one network call per ~600ms quiet period. */
    let saveTimer = null;
    let saveBusy  = false;
    const scheduleSave = (showStatus) => {
        cacheWrite(CONFIG);
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            saveBusy = true;
            showStatus?.("saving…");
            try {
                await apiPut(CONFIG);
                showStatus?.("saved");
            } catch (e) {
                showStatus?.("offline — cached locally");
            } finally {
                saveBusy = false;
            }
        }, 600);
    };

    const getFragment = (group, val) => {
        if (STATIC_FRAGMENTS[group]) return STATIC_FRAGMENTS[group][val];
        const cat = CONFIG.categories.find((c) => c.id === group);
        return cat?.chips.find((c) => c.value === val)?.fragment;
    };

    /* ---------- CHIP SELECTION + PROMPT READOUT ---------- */
    const selections = {};
    const readout    = document.getElementById("promptReadout");
    const director   = document.querySelector(".director");

    const renderReadout = () => {
        if (!readout) return;
        const parts = [];
        for (const group of Object.keys(selections)) {
            const frag = getFragment(group, selections[group]);
            if (frag) parts.push(frag);
        }
        const note = director?.value?.trim();
        if (note) parts.push(note);
        readout.textContent = parts.length ? parts.join(", ") : "— awaiting input —";
    };

    /* event delegation on the gen-grid container — handles clicks on chips
       from any panel, dynamic or static. */
    const genGrid = document.querySelector(".gen-grid");
    if (genGrid && PAGE !== "dashboard") {
        genGrid.addEventListener("click", (e) => {
            const chip = e.target.closest(".chip");
            if (!chip) return;
            const grid = chip.closest(".chip-grid");
            if (!grid) return;
            const group = grid.dataset.group;
            if (!group) return;
            e.preventDefault();
            const val = chip.dataset.value;
            if (selections[group] === val) {
                delete selections[group];
                chip.classList.remove("is-selected");
            } else {
                grid.querySelectorAll(".chip.is-selected").forEach((c) => c.classList.remove("is-selected"));
                chip.classList.add("is-selected");
                selections[group] = val;
            }
            renderReadout();
        });
    }

    if (director) director.addEventListener("input", renderReadout);

    /* ---------- RENDER PANELS ON IMAGE / VIDEO PAGES ----------
       categories whose `showOn` includes the current page get prepended
       to the gen-grid as their own gen-panel. static panels (color/
       duration/dropzone/notes) follow them in the source order. */
    const dynamicHost = document.getElementById("dynamicPanels");

    const renderGenPanels = () => {
        if (!dynamicHost || PAGE === "dashboard") return;
        const here = CONFIG.categories.filter((c) =>
            Array.isArray(c.showOn) && c.showOn.includes(PAGE)
        );
        dynamicHost.innerHTML = here.map((cat) => `
            <div class="gen-panel">
                <div class="panel-bar">
                    <span class="panel-tag"></span>
                    <span class="panel-name">// ${escapeHTML(cat.label)}</span>
                    <span class="panel-hint">${escapeHTML(cat.hint || "choose one")}</span>
                </div>
                <div class="chip-grid" data-group="${escapeHTML(cat.id)}">
                    ${cat.chips.map((c) =>
                        `<button class="chip" data-value="${escapeHTML(c.value)}">${escapeHTML(c.label)}</button>`
                    ).join("")}
                </div>
            </div>
        `).join("");
        // renumber all panels in the grid (dynamic + static)
        document.querySelectorAll(".gen-grid .gen-panel").forEach((panel, i) => {
            const tag = panel.querySelector(".panel-tag");
            if (tag) tag.textContent = String(i + 1).padStart(2, "0");
        });
    };

    /* ---------- DASHBOARD ----------
       full CRUD on categories and chips. inputs save on debounced blur. */
    const dashboardEl = document.querySelector(".dashboard");
    const dashGrid    = document.getElementById("dashGrid");
    const dashStatus  = document.getElementById("dashStatus");
    const setStatus   = (msg) => { if (dashStatus) dashStatus.textContent = msg; };

    const renderDashboard = () => {
        if (!dashGrid) return;
        if (!CONFIG.categories.length) {
            dashGrid.innerHTML = `<div class="dash-empty">— no categories yet. add one above. —</div>`;
            return;
        }
        dashGrid.innerHTML = CONFIG.categories.map((cat, ci) => `
            <div class="dash-panel gen-panel" data-cat-id="${escapeHTML(cat.id)}">
                <div class="panel-bar">
                    <span class="panel-tag">${String(ci + 1).padStart(2, "0")}</span>
                    <input class="dash-cat-label" value="${escapeHTML(cat.label)}" maxlength="32" aria-label="Category label"/>
                    <button class="dash-cat-remove" type="button" aria-label="Delete category">delete</button>
                </div>
                <div class="dash-cat-meta">
                    <span class="dash-cat-id">id: <code>${escapeHTML(cat.id)}</code></span>
                    <label class="dash-toggle">
                        <input type="checkbox" data-show="image" ${cat.showOn?.includes("image") ? "checked" : ""}/>
                        <span>image</span>
                    </label>
                    <label class="dash-toggle">
                        <input type="checkbox" data-show="video" ${cat.showOn?.includes("video") ? "checked" : ""}/>
                        <span>video</span>
                    </label>
                </div>
                <div class="dash-chips">
                    ${(cat.chips || []).map((c, i) => `
                        <div class="dash-chip" data-chip-i="${i}">
                            <div class="dash-chip-head">
                                <input class="dash-chip-label-input" value="${escapeHTML(c.label)}" maxlength="40" aria-label="Chip label"/>
                                <button class="dash-chip-remove" type="button" aria-label="Remove chip">×</button>
                            </div>
                            <input class="dash-chip-frag-input" value="${escapeHTML(c.fragment)}" maxlength="240" aria-label="Prompt fragment"/>
                        </div>
                    `).join("") || `<div class="dash-empty">— no chips yet. add one below. —</div>`}
                </div>
                <form class="dash-add">
                    <input name="label"    type="text" placeholder="NEW CHIP LABEL"            maxlength="32"  required/>
                    <input name="fragment" type="text" placeholder="prompt fragment to inject" maxlength="200" required/>
                    <button class="dash-add-btn" type="submit"><span>+ add chip</span></button>
                </form>
            </div>
        `).join("");
    };

    const handleDashboardInput = (e) => {
        const panel = e.target.closest(".dash-panel");
        if (!panel) return;
        const catId = panel.dataset.catId;
        const cat = CONFIG.categories.find((c) => c.id === catId);
        if (!cat) return;

        if (e.target.classList.contains("dash-cat-label")) {
            cat.label = e.target.value;
            scheduleSave(setStatus);
            return;
        }
        if (e.target.matches('.dash-toggle input[type="checkbox"]')) {
            const which = e.target.dataset.show;
            cat.showOn = cat.showOn || [];
            const has = cat.showOn.includes(which);
            if (e.target.checked && !has) cat.showOn.push(which);
            if (!e.target.checked && has) cat.showOn = cat.showOn.filter((s) => s !== which);
            scheduleSave(setStatus);
            return;
        }
        const chipEl = e.target.closest(".dash-chip");
        if (chipEl) {
            const i = parseInt(chipEl.dataset.chipI, 10);
            const chip = cat.chips[i];
            if (!chip) return;
            if (e.target.classList.contains("dash-chip-label-input")) {
                chip.label = e.target.value;
                scheduleSave(setStatus);
            } else if (e.target.classList.contains("dash-chip-frag-input")) {
                chip.fragment = e.target.value;
                scheduleSave(setStatus);
            }
        }
    };

    const handleDashboardClick = (e) => {
        const panel = e.target.closest(".dash-panel");

        if (e.target.closest(".dash-chip-remove")) {
            if (!panel) return;
            const chipEl = e.target.closest(".dash-chip");
            const i = parseInt(chipEl.dataset.chipI, 10);
            const cat = CONFIG.categories.find((c) => c.id === panel.dataset.catId);
            if (!cat) return;
            cat.chips.splice(i, 1);
            renderDashboard();
            scheduleSave(setStatus);
            return;
        }

        if (e.target.closest(".dash-cat-remove")) {
            if (!panel) return;
            if (!confirm(`Delete the "${panel.querySelector(".dash-cat-label").value}" category and all its chips?`)) return;
            CONFIG.categories = CONFIG.categories.filter((c) => c.id !== panel.dataset.catId);
            renderDashboard();
            scheduleSave(setStatus);
            return;
        }

        if (e.target.closest("#dashResetAll")) {
            if (!confirm("Reset everything to defaults? Your custom chips will be lost.")) return;
            setStatus("resetting…");
            apiReset()
                .then((data) => { CONFIG = data; cacheWrite(CONFIG); renderDashboard(); setStatus("reset to defaults"); })
                .catch(() => setStatus("reset failed"));
        }
    };

    const handleDashboardSubmit = (e) => {
        const form = e.target.closest(".dash-add");
        if (form) {
            e.preventDefault();
            const panel = form.closest(".dash-panel");
            const cat = CONFIG.categories.find((c) => c.id === panel.dataset.catId);
            if (!cat) return;
            const labelInput = form.querySelector('[name="label"]');
            const fragInput  = form.querySelector('[name="fragment"]');
            const label = labelInput.value.trim();
            const frag  = fragInput.value.trim();
            if (!label || !frag) return;
            const value = slugify(label);
            if (!value) return;
            if (cat.chips.some((c) => c.value === value)) {
                setStatus(`"${label}" already exists in this category`);
                return;
            }
            cat.chips.push({ value, label: label.toUpperCase(), fragment: frag });
            renderDashboard();
            scheduleSave(setStatus);
            return;
        }

        const newCatForm = e.target.closest("#dashNewCategory");
        if (newCatForm) {
            e.preventDefault();
            const labelInput = newCatForm.querySelector('[name="label"]');
            const hintInput  = newCatForm.querySelector('[name="hint"]');
            const onImage    = newCatForm.querySelector('[name="image"]').checked;
            const onVideo    = newCatForm.querySelector('[name="video"]').checked;
            const label = labelInput.value.trim();
            if (!label) return;
            const id = slugify(label);
            if (!id) return;
            if (CONFIG.categories.some((c) => c.id === id)) {
                setStatus(`category "${id}" already exists`);
                return;
            }
            const showOn = [];
            if (onImage) showOn.push("image");
            if (onVideo) showOn.push("video");
            CONFIG.categories.push({
                id,
                label: label.toUpperCase(),
                hint: hintInput.value.trim() || "choose one",
                showOn: showOn.length ? showOn : ["image", "video"],
                chips: [],
            });
            renderDashboard();
            scheduleSave(setStatus);
            labelInput.value = "";
            hintInput.value  = "";
        }
    };

    if (dashboardEl) {
        dashboardEl.addEventListener("input",   handleDashboardInput);
        dashboardEl.addEventListener("change",  handleDashboardInput);
        dashboardEl.addEventListener("click",   handleDashboardClick);
        dashboardEl.addEventListener("submit",  handleDashboardSubmit);
    }

    /* ---------- BOOTSTRAP ----------
       paint instantly from cache; then refresh from API in background.   */
    const paint = () => {
        if (PAGE === "dashboard") renderDashboard();
        else renderGenPanels();
    };

    const cached = cacheRead();
    if (cached?.categories) {
        CONFIG = cached;
        paint();
    }

    if (PAGE) {
        apiGet()
            .then((data) => {
                if (data?.categories) {
                    CONFIG = data;
                    cacheWrite(CONFIG);
                    paint();
                    setStatus("loaded");
                }
            })
            .catch(() => {
                if (!cached) {
                    // last-ditch: empty state, dashboard will let user add things
                    paint();
                }
                setStatus("offline mode");
            });
    }

    /* ---------- DROPZONE ---------- */
    const drop = document.querySelector(".dropzone");
    const dropSub = document.getElementById("dropSub");
    const refUpload = document.getElementById("refUpload");
    if (drop && refUpload) {
        ["dragenter", "dragover"].forEach((ev) =>
            drop.addEventListener(ev, (e) => {
                e.preventDefault();
                drop.classList.add("is-drag");
            })
        );
        ["dragleave", "drop"].forEach((ev) =>
            drop.addEventListener(ev, (e) => {
                e.preventDefault();
                drop.classList.remove("is-drag");
            })
        );
        drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer?.files?.[0];
            if (f) {
                refUpload.files = e.dataTransfer.files;
                if (dropSub) dropSub.textContent = `loaded: ${f.name}`;
            }
        });
        refUpload.addEventListener("change", () => {
            const f = refUpload.files?.[0];
            if (f && dropSub) dropSub.textContent = `loaded: ${f.name}`;
        });
    }

    /* ---------- GENERATION MODAL ----------
       opens when GENERATE/RENDER is clicked. drives the call to /api/generate
       then polls /api/status until the video is ready or fails.              */
    const modal       = document.getElementById("genModal");
    const modalStatus = document.getElementById("genModalStatus");
    const modalTimer  = document.getElementById("genModalTimer");
    const modalPrompt = document.getElementById("genModalPrompt");
    const modalResult = document.getElementById("genModalResult");
    const modalDL     = document.getElementById("genModalDownload");
    const modalError  = document.getElementById("genModalError");

    let activePollId = null;
    let activeTimerId = null;
    let modalStartedAt = 0;

    const setPane = (which) => {
        if (!modal) return;
        modal.querySelectorAll(".gen-modal-pane").forEach((p) => {
            p.hidden = (p.dataset.pane !== which);
        });
    };

    const openModal = (initialPane = "loading") => {
        if (!modal) return;
        modal.hidden = false;
        setPane(initialPane);
        document.body.style.overflow = "hidden";
    };

    const closeModal = () => {
        if (!modal) return;
        modal.hidden = true;
        document.body.style.overflow = "";
        if (activePollId) { clearTimeout(activePollId); activePollId = null; }
        if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
    };

    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target.closest("[data-close-modal]")) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !modal.hidden) closeModal();
        });
    }

    const formatTimer = (ms) => {
        const s = Math.floor(ms / 1000);
        return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };

    const startTimer = () => {
        modalStartedAt = Date.now();
        if (modalTimer) modalTimer.textContent = "00:00";
        activeTimerId = setInterval(() => {
            if (modalTimer) modalTimer.textContent = formatTimer(Date.now() - modalStartedAt);
        }, 500);
    };

    /* ---------- BUILD THE GENERATION REQUEST ----------
       reads the current chip selections + director note + uploaded file. */
    const buildPrompt = () => readout?.textContent && readout.textContent !== "— awaiting input —"
        ? readout.textContent
        : "";

    const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });

    const collectRequest = async () => {
        const prompt = buildPrompt();
        const fileInput = document.getElementById("refUpload");
        const file = fileInput?.files?.[0];
        const req = {
            prompt,
            duration: selections.duration || "5",
            page: PAGE,
        };
        if (file) {
            // 4MB ceiling so we stay under vercel's 4.5MB body limit with overhead
            if (file.size > 4 * 1024 * 1024) {
                throw new Error("reference file too large — max 4MB on free tier");
            }
            req.reference = await readFileAsDataURL(file);
            req.referenceType = file.type.startsWith("video/") ? "video" : "image";
        }
        return req;
    };

    /* ---------- POLL /api/status UNTIL DONE ---------- */
    const POLL_INTERVAL = 5000;
    const MAX_WAIT_MS   = 5 * 60 * 1000;  // 5 minutes

    const pollStatus = (taskId, kind, startedAt) => {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
            modalError.textContent = "render timed out after 5 minutes — try again";
            setPane("error");
            if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
            return;
        }
        fetch(`/api/status?id=${encodeURIComponent(taskId)}&kind=${encodeURIComponent(kind)}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.error) {
                    modalError.textContent = data.error;
                    setPane("error");
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    return;
                }
                if (data.status === "succeeded" && data.videoUrl) {
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    modalResult.innerHTML = `<video src="${data.videoUrl}" controls autoplay loop playsinline></video>`;
                    modalDL.href = data.videoUrl;
                    modalDL.download = `xperiment_${taskId}.mp4`;
                    setPane("success");
                    return;
                }
                if (data.status === "failed") {
                    modalError.textContent = data.message || "kling rejected the render";
                    setPane("error");
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    return;
                }
                // still processing — update status text, keep polling
                if (modalStatus) modalStatus.textContent = `// ${data.message || "rendering..."}`;
                activePollId = setTimeout(() => pollStatus(taskId, kind, startedAt), POLL_INTERVAL);
            })
            .catch((err) => {
                modalError.textContent = `polling failed: ${err.message}`;
                setPane("error");
                if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
            });
    };

    /* ---------- WIRE THE GENERATE BUTTON ---------- */
    const genBtn = document.getElementById("generateBtn");
    if (genBtn) {
        genBtn.addEventListener("click", async () => {
            // image page isn't wired to a backend yet
            if (PAGE === "image") {
                openModal("comingSoon");
                return;
            }

            // need at least one selection or a director note
            const prompt = buildPrompt();
            if (!prompt) {
                openModal("error");
                modalError.textContent = "pick at least one chip or write a director note";
                return;
            }

            openModal("loading");
            if (modalPrompt) modalPrompt.textContent = prompt;
            if (modalStatus) modalStatus.textContent = "// uploading signal to kling...";
            startTimer();

            try {
                const body = await collectRequest();
                const r = await fetch("/api/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                const data = await r.json();
                if (!r.ok || data.error) {
                    modalError.textContent = data.error || `server returned ${r.status}`;
                    setPane("error");
                    if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
                    return;
                }
                if (modalStatus) modalStatus.textContent = "// task accepted. waiting for frames...";
                pollStatus(data.taskId, data.kind || "text2video", Date.now());
            } catch (err) {
                modalError.textContent = err.message || "request failed";
                setPane("error");
                if (activeTimerId) { clearInterval(activeTimerId); activeTimerId = null; }
            }
        });
    }
})();
