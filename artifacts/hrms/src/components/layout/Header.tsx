import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/components/theme-provider';
import { useGetAuthMe } from '@workspace/api-client-react';
import { Moon, Sun, Languages, Bell, Search, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from '@/components/ui/input';

export function Header() {
  const { lang, setLang, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { data: user } = useGetAuthMe();

  const userInitial = user ? (lang === 'en' ? user.fullNameEn.charAt(0) : user.fullNameAr.charAt(0)) : 'A';

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="w-5 h-5" />
        </Button>
        <div className="relative hidden sm:block w-64">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder={t('Search anywhere...', 'البحث في كل مكان...')} 
            className="ps-9 bg-background/50 border-muted h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="w-9 h-9">
              <Languages className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLang('en')} className={lang === 'en' ? 'bg-accent' : ''}>
              English
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLang('ar')} className={lang === 'ar' ? 'bg-accent' : ''}>
              العربية (Arabic)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="w-9 h-9">
              {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" className="w-9 h-9 relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 end-2 w-2 h-2 bg-destructive rounded-full" />
        </Button>

        <div className="h-8 w-8 ms-2 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm uppercase">
          {userInitial}
        </div>
      </div>
    </header>
  );
}
