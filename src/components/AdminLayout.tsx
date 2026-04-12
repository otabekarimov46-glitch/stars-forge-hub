import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Film, BarChart3, Users, Bell, Settings, Sun, Moon, Globe } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import logoImg from "@/assets/logo.png";

const menuItems = [
  { titleKey: "nav.statistics" as const, url: "/admin/statistics", icon: BarChart3 },
  { titleKey: "nav.content" as const, url: "/admin/content", icon: Film },
  { titleKey: "nav.users" as const, url: "/admin/users", icon: Users },
  { titleKey: "nav.alerts" as const, url: "/admin/alerts", icon: Bell },
  { titleKey: "nav.settings" as const, url: "/admin/settings", icon: Settings },
];

function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { t } = useTranslation();

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="glass">
        <div className={`flex items-center gap-3 px-4 py-5 ${collapsed ? "justify-center" : ""}`}>
          <img src={logoImg} alt="Logo" className="w-10 h-10 rounded-xl shadow-lg" />
          {!collapsed && (
            <span className="text-lg font-bold bg-gradient-to-r from-brand-purple to-brand-blue bg-clip-text text-transparent">
              StarBot
            </span>
          )}
        </div>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.titleKey}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-primary/5 rounded-xl transition-all duration-200 mx-2"
                      activeClassName="bg-primary/10 text-primary font-semibold shadow-sm"
                    >
                      <item.icon className="mr-3 h-5 w-5" />
                      {!collapsed && <span>{t(item.titleKey)}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center justify-between px-6 glass border-b-0 sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="rounded-xl" />
              <h1 className="text-lg font-semibold hidden sm:block">{t("nav.title")}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl"
                onClick={() => setLang(lang === "ru" ? "en" : "ru")}
              >
                <Globe className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl"
                onClick={toggleTheme}
              >
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
