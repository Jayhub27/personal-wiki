const form = document.getElementById("ask-form");
const input = document.getElementById("ask-input");
const output = document.getElementById("ask-answer");

if (form && input && output) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    output.classList.remove("hidden");
    output.textContent = "Thinking…";
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) { output.textContent = data.error || "Something went wrong."; return; }
      if (!data.configured) { output.textContent = "AI is not configured."; return; }
      const sources = (data.sources || [])
        .map((s) => `<a class="tag" href="/${encodeURIComponent(s.slug)}">${escapeHtml(s.title)}</a>`)
        .join("");
      output.innerHTML = `<div class="ask-md">${data.answerHtml || ""}</div>`
        + (sources ? `<div class="ask-sources"><strong>Sources</strong><div class="tags">${sources}</div></div>` : "");
    } catch (err) {
      output.textContent = "Request failed: " + err.message;
    }
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
