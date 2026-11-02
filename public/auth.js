const auth$ = id => document.getElementById(id);
let pendingRobloxUser = null;
function authMessage(message, isError = false) {
  const el = auth$("authMessage");
  el.textContent = message || "";
  el.classList.toggle("error", !!isError);
}
async function authRequest(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
auth$("robloxStartForm").addEventListener("submit", async event => {
  event.preventDefault();
  const username = auth$("robloxInput").value.trim();
  const button = event.submitter;
  button.disabled = true;
  authMessage("Looking up your Roblox username…");
  try {
    const data = await authRequest("/api/roblox/start", { username });
    pendingRobloxUser = data;
    auth$("verifyPhrase").textContent = data.phrase;
    auth$("robloxProfileLink").href = data.profileUrl;
    auth$("verifySteps").classList.remove("hidden");
    authMessage("Found @" + data.username + ". Add the phrase to your public Roblox bio, then verify here.");
  } catch (error) {
    authMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});
auth$("copyPhrase").addEventListener("click", async () => {
  const phrase = auth$("verifyPhrase").textContent;
  try {
    await navigator.clipboard.writeText(phrase);
    auth$("copyPhrase").textContent = "Copied!";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(auth$("verifyPhrase"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    authMessage("Select and copy the highlighted phrase.");
  }
});
auth$("verifyRoblox").addEventListener("click", async () => {
  if (!pendingRobloxUser) return authMessage("Start by entering your Roblox username.", true);
  const button = auth$("verifyRoblox");
  button.disabled = true;
  authMessage("Checking your public Roblox bio…");
  try {
    const data = await authRequest("/api/roblox/verify", { userId: pendingRobloxUser.userId });
    authMessage("Verified! Signing you in as @" + data.username + "…");
    window.location.reload();
  } catch (error) {
    authMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});
auth$("logout").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    window.location.reload();
  }
});
(async () => {
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    const me = await response.json();
    if (me.authenticated) {
      auth$("authGate").classList.add("hidden");
      auth$("robloxUsername").textContent = "@" + me.username;
      auth$("robloxAccount").classList.remove("hidden");
      auth$("logout").classList.remove("hidden");
      auth$("name").value = me.username;
      auth$("name").readOnly = true;
      auth$("name").setAttribute("aria-label", "Verified Roblox username");
      auth$("saveName").classList.add("hidden");
    } else {
      auth$("authGate").classList.remove("hidden");
    }
  } catch {
    auth$("authGate").classList.remove("hidden");
    authMessage("Could not check sign-in status. Refresh the page and try again.", true);
  }
})();
