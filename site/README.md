# Domaeng Website

Static website for the Domaeng open-source project.

## Local preview

Open `index.html` directly in a browser, or serve this directory with any static file server.

## Static hosting

Upload the contents of this `site/` directory to your static host. Keep `index.html`, `styles.css`,
`app.js`, `site-config.js`, and `assets/` at the same level.

## Optional self-hosted entry

The default site does not point at a production relay or API gateway. Edit `site-config.js` only when
you want the banner to link to your own local, Tailscale, or self-hosted Domaeng Web App URL:

```js
window.DOMAENG_SITE_CONFIG = {
  selfHostedUrl: "",
  selfHostedLabel: "自托管入口",
  selfHostedBannerTitle: "需要连接自己的 relay 或内网入口？",
  selfHostedBannerText: "把这里配置成你的本地、Tailscale 或自托管 Domaeng Web App 地址。",
  selfHostedBannerCta: "查看自托管说明",
  githubUrl: "https://github.com/hhaajack/domaeng"
};
```
