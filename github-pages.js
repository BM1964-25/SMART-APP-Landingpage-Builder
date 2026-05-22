const localUrl = "http://127.0.0.1:8173/";
const statusText = document.querySelector("#statusText");

async function checkLocalApp() {
  try {
    await fetch(localUrl, { mode: "no-cors", cache: "no-store" });
    statusText.textContent = "Lokale App scheint erreichbar zu sein.";
  } catch {
    statusText.textContent = "Lokale App noch nicht erreichbar. Bitte zuerst die macOS-App oder npm start öffnen.";
  }
}

document.querySelector("#openLocalButton").addEventListener("click", () => {
  window.location.href = localUrl;
});

checkLocalApp();
