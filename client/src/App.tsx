import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SettingsLayout } from "./components/SettingsLayout";
import { Home } from "./pages/Home";
import { Accounts } from "./pages/Accounts";
import { AccountDetail } from "./pages/AccountDetail";
import { Fx } from "./pages/Fx";
import { TaxReport } from "./pages/TaxReport";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* 収支 (analytics) */}
          <Route index element={<Home />} />
          <Route path="accounts/:id" element={<AccountDetail />} />
          {/* 確定申告 */}
          <Route path="reports/tax" element={<TaxReport />} />
          {/* 設定 (management). CSV取込 lives inside the アカウント page. */}
          <Route path="settings" element={<SettingsLayout />}>
            <Route
              index
              element={<Navigate to="/settings/accounts" replace />}
            />
            <Route path="accounts" element={<Accounts />} />
            <Route path="fx" element={<Fx />} />
          </Route>
          {/* Redirects for the pre-reorg routes (old bookmarks). */}
          <Route
            path="accounts"
            element={<Navigate to="/settings/accounts" replace />}
          />
          <Route
            path="upload"
            element={<Navigate to="/settings/accounts" replace />}
          />
          <Route
            path="settings/import"
            element={<Navigate to="/settings/accounts" replace />}
          />
          <Route path="fx" element={<Navigate to="/settings/fx" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
