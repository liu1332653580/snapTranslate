import { useEffect } from "react";
import { MainView } from "./components/MainView";
import { Overlay } from "./components/Overlay";
import { Toaster } from "./components/ui/Toast";
import { useAppStore } from "./lib/store";

/**
 * Routing is hash-based — the Tauri config sets the overlay window's URL to
 * `index.html#/overlay`. In web dev mode we never navigate there; it only
 * matters inside the Tauri app.
 */
function getRoute(): "main" | "overlay" {
  return window.location.hash === "#/overlay" ? "overlay" : "main";
}

export default function App() {
  const route = getRoute();
  const loadSettings = useAppStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <>
      {route === "overlay" ? <Overlay /> : <MainView />}
      <Toaster />
    </>
  );
}
