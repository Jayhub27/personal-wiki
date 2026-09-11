const container = document.getElementById("graph");
if (container && container.dataset.graph) {
  const data = JSON.parse(container.dataset.graph);
  const width = Math.max(320, container.clientWidth || 800);
  const height = Math.max(420, Math.min(680, window.innerHeight - 240));
  const ns = "http://www.w3.org/2000/svg";
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "graph-svg");
  container.appendChild(svg);

  const radius = (n) => 6 + Math.min(14, (n.tags?.length || 0) * 2);
  const nodes = data.nodes.map((n, i) => {
    const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
    const r = Math.min(width, height) / 3;
    return { ...n, x: width / 2 + Math.cos(angle) * r, y: height / 2 + Math.sin(angle) * r, vx: 0, vy: 0, r: radius(n) };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = data.edges
    .map((e) => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) }))
    .filter((e) => e.s && e.t);

  const linkLayer = document.createElementNS(ns, "g");
  const nodeLayer = document.createElementNS(ns, "g");
  svg.append(linkLayer, nodeLayer);

  const linkEls = edges.map((e) => {
    const line = document.createElementNS(ns, "line");
    if (e.kind === "parent") line.setAttribute("class", "graph-link parent");
    else line.setAttribute("class", "graph-link");
    linkLayer.appendChild(line);
    return line;
  });

  let dragged = null;
  const nodeEls = nodes.map((n) => {
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "graph-node");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", n.r);
    const label = document.createElementNS(ns, "text");
    label.textContent = n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title;
    label.setAttribute("dy", n.r + 13);
    g.append(circle, label);
    g.addEventListener("click", () => { if (!dragged) window.location.href = "/" + n.id; });
    g.addEventListener("pointerdown", (e) => { dragged = n; n.fixed = true; g.setPointerCapture?.(e.pointerId); e.preventDefault(); });
    g.addEventListener("pointermove", (e) => {
      if (dragged !== n) return;
      const rect = svg.getBoundingClientRect();
      n.x = ((e.clientX - rect.left) / rect.width) * width;
      n.y = ((e.clientY - rect.top) / rect.height) * height;
      n.vx = 0; n.vy = 0;
      draw();
    });
    g.addEventListener("pointerup", () => { n.fixed = false; setTimeout(() => { dragged = null; }, 0); });
    nodeLayer.appendChild(g);
    return g;
  });

  const center = { x: width / 2, y: height / 2 };

  function step() {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const force = 2600 / (dist * dist);
        dx /= dist; dy /= dist;
        a.vx -= dx * force; a.vy -= dy * force;
        b.vx += dx * force; b.vy += dy * force;
      }
    }
    for (const e of edges) {
      const dx = e.t.x - e.s.x;
      const dy = e.t.y - e.s.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist - 110) * 0.008;
      const ux = dx / dist, uy = dy / dist;
      e.s.vx += ux * force; e.s.vy += uy * force;
      e.t.vx -= ux * force; e.t.vy -= uy * force;
    }
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx += (center.x - n.x) * 0.002;
      n.vy += (center.y - n.y) * 0.002;
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(20, Math.min(width - 20, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    }
  }

  function draw() {
    linkEls.forEach((line, i) => {
      const e = edges[i];
      line.setAttribute("x1", e.s.x); line.setAttribute("y1", e.s.y);
      line.setAttribute("x2", e.t.x); line.setAttribute("y2", e.t.y);
    });
    nodeEls.forEach((g, i) => {
      g.setAttribute("transform", `translate(${nodes[i].x}, ${nodes[i].y})`);
    });
  }

  if (reduced) {
    for (let i = 0; i < 300; i++) step();
    draw();
  } else {
    const loop = () => { step(); draw(); requestAnimationFrame(loop); };
    loop();
  }
}
