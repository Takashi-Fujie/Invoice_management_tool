import React from "react";
import { createRoot } from "react-dom/client";
import { BackupPage } from "./BackupPanel";
import { backupPeriod } from "./page-navigation.mjs";
import "./style.css";
const context = backupPeriod(window.location.href);
createRoot(document.getElementById("root")!).render(
  <BackupPage {...context} />,
);
