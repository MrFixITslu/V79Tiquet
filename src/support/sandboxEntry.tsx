import React,{StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {IsolatedSupportEntry} from "./SupportDeskSandbox";
const mount=document.getElementById("root");
if(!mount)throw new Error("Synthetic Support Desk root is missing");
createRoot(mount).render(<StrictMode><IsolatedSupportEntry/></StrictMode>);
