try {
  var t = localStorage.getItem("aetherwiki-theme");
  if (!t) t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  if (localStorage.getItem("aetherwiki-bg") === "off") document.documentElement.dataset.bg = "off";
} catch (e) {}
