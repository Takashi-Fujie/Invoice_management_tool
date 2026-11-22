import React from "react";
import { version } from "../package.json";

export function AppFooter({ children }: { children?: React.ReactNode }) {
  return (
    <footer className="app-footer">
      {children}
      <span className="app-version">バージョン {version}</span>
    </footer>
  );
}
