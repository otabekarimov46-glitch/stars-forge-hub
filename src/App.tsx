import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import AdminLayout from "@/components/AdminLayout";
import ContentPage from "@/pages/admin/ContentPage";
import StatisticsPage from "@/pages/admin/StatisticsPage";
import UsersPage from "@/pages/admin/UsersPage";
import AlertsPage from "@/pages/admin/AlertsPage";
import SettingsPage from "@/pages/admin/SettingsPage";
import MiniApp from "@/pages/MiniApp";
import { MiniAppI18nProvider } from "@/lib/miniapp-i18n";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/admin/statistics" replace />} />
              <Route path="/app" element={<MiniApp />} />
              <Route path="/admin/*" element={
                <AdminLayout>
                  <Routes>
                    <Route path="content" element={<ContentPage />} />
                    <Route path="statistics" element={<StatisticsPage />} />
                    <Route path="users" element={<UsersPage />} />
                    <Route path="alerts" element={<AlertsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="statistics" replace />} />
                  </Routes>
                </AdminLayout>
              } />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
