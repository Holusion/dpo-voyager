window.addEventListener("DOMContentLoaded", async () => {
  const status = document.getElementById("demo-status");
  try {
    const app = window.voyagerStory;
    const manager = app.system.getComponent("CVStandaloneFileManager");
    const root = new URL("demo/", document.baseURI);
    const paths = ["Mausolée_Seclin_V2.glb", "Mausolée_Seclin_V3_Tumulis.glb", "Mausolée_Toit_Seclin.glb", "articles/Reims.jpg", "articles/amueltte.jpg", "articles/new-article-C38AqpRKchuq-FR.html", "articles/new-article-KOB6CpxuMr11-FR.html", "articles/new-article-nHf19keviY5Q-FR.html", "articles/new-article-rcenHkaaz3Pa-FR.html", "articles/tesselle_mero.jpg", "scene-image-high.jpg", "scene-image-low.jpg", "scene-image-medium.jpg", "scene-image-thumb.jpg", "scene.svx.json"];
    const contents = await Promise.all(paths.map(async path => {
      const response = await fetch(new URL(path, root));
      if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
      return [path, await response.blob()];
    }));
    for (const [path, blob] of contents) manager.addFile(path, [blob]);
    app.setBaseUrl(root.href);
    await app.loadDocument("scene.svx.json");
    status.hidden = true;
    window.voyagerDemoReady = true;
  } catch (error) {
    status.textContent = `Demo failed to load: ${error.message}`;
    status.setAttribute("role", "alert");
    window.voyagerDemoError = error;
    console.error(error);
  }
});
