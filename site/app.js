(function () {
  const config = window.DOMAENG_SITE_CONFIG || {};

  document.querySelectorAll("[data-config-href]").forEach((node) => {
    const key = node.getAttribute("data-config-href");
    if (key && config[key]) {
      node.setAttribute("href", config[key]);
    }
    if (node.hostname && node.hostname !== window.location.hostname) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  document.querySelectorAll("[data-config-text]").forEach((node) => {
    const key = node.getAttribute("data-config-text");
    if (key && config[key]) {
      node.textContent = config[key];
    }
  });

  document.querySelectorAll("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
})();
