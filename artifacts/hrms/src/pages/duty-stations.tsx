import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import { useListDutyStations, useCreateDutyStation } from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, MapPin, Globe, Lock } from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
const CLASSIF_LEVELS = ['unclassified','restricted','confidential','secret','top_secret'];
const STATION_TYPES = ['headquarters','field','forward_operating_base','embassy','liaison','training','logistics','administrative'];

function classifBadge(lvl: string) {
  const cfg: Record<string, { cls: string; label: string; icon?: string }> = {
    unclassified: { cls: 'bg-gray-100 text-gray-600 border-transparent', label: 'UNCLASSIFIED' },
    restricted: { cls: 'bg-yellow-100 text-yellow-700 border-transparent', label: 'RESTRICTED' },
    confidential: { cls: 'bg-orange-100 text-orange-700 border-transparent', label: 'CONFIDENTIAL' },
    secret: { cls: 'bg-red-100 text-red-700 border-transparent', label: 'SECRET' },
    top_secret: { cls: 'bg-red-200 text-red-900 border-transparent', label: '☠ TOP SECRET', icon: '☠' },
  };
  const c = cfg[lvl] ?? cfg.unclassified;
  return <Badge className={cn('text-xs font-semibold', c.cls)}>{c.label}</Badge>;
}

function stationTypeBadge(type: string) {
  return <Badge variant="outline" className="text-xs capitalize">{type?.replace(/_/g,' ')}</Badge>;
}

// ─── Create Dialog ────────────────────────────────────────────────────────────
function CreateStationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    stationCode: '', nameEn: '', nameAr: '', country: '', region: '', city: '',
    stationType: 'headquarters', classificationLevel: 'unclassified', latitude: '', longitude: '',
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const createMutation = useCreateDutyStation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listDutyStations'] });
        onClose();
        setForm({ stationCode:'', nameEn:'', nameAr:'', country:'', region:'', city:'', stationType:'headquarters', classificationLevel:'unclassified', latitude:'', longitude:'' });
        toast({ title: t('Duty station created','تم إنشاء محطة الخدمة') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Create Duty Station','إنشاء محطة خدمة')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2 max-h-[65vh] overflow-y-auto">
          {([['stationCode','Station Code','رمز المحطة'],['nameEn','Name EN','الاسم EN'],
            ['nameAr','Name AR','الاسم AR'],['country','Country','الدولة'],
            ['region','Region','المنطقة'],['city','City','المدينة'],
            ['latitude','Latitude (optional)','خط العرض (اختياري)'],
            ['longitude','Longitude (optional)','خط الطول (اختياري)']] as const).map(([key, label, labelAr]) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
              <Input value={form[key as keyof typeof form]} onChange={f(key as keyof typeof form)} placeholder={t(label, labelAr)} />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Station Type','نوع المحطة')}</label>
            <Select value={form.stationType} onValueChange={v => setForm(p => ({...p, stationType:v}))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATION_TYPES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">{t('Classification Level','مستوى التصنيف')}</label>
            <Select value={form.classificationLevel} onValueChange={v => setForm(p => ({...p, classificationLevel:v}))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CLASSIF_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel','إلغاء')}</Button>
          <Button disabled={createMutation.isPending || !form.stationCode || !form.nameEn}
            onClick={() => createMutation.mutate({ data: { ...form, latitude: form.latitude ? String(form.latitude) : null, longitude: form.longitude ? String(form.longitude) : null } } as any)}>
            {t('Create','إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DutyStations() {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const { data: stations, isLoading } = useListDutyStations();

  const filtered = (stations ?? []).filter((s: any) => {
    const matchSearch = !search || s.nameEn?.toLowerCase().includes(search.toLowerCase()) || s.stationCode?.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || s.stationType === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('Duty Stations','محطات الخدمة')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('Manage operational duty stations and locations','إدارة محطات الخدمة والمواقع التشغيلية')}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder={t('Search stations...','بحث في المحطات...')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-60"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('All Types','كل الأنواع')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All Types','كل الأنواع')}</SelectItem>
              {STATION_TYPES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="ml-auto">{filtered.length} {t('stations','محطة')}</Badge>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_,i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <MapPin className="w-10 h-10 mb-3 opacity-30" />
            <p>{t('No duty stations found','لا توجد محطات خدمة')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((s: any) => (
              <Card key={s.id} className="rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge className="bg-indigo-100 text-indigo-700 border-transparent text-xs font-mono mb-1">{s.stationCode}</Badge>
                      <h3 className="font-semibold text-gray-900 dark:text-white leading-tight">{s.nameEn}</h3>
                      {s.nameAr && <p className="text-sm text-gray-500 dark:text-gray-400 font-arabic">{s.nameAr}</p>}
                    </div>
                    <Lock className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                  </div>

                  <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                    <Globe className="w-3.5 h-3.5" />
                    <span>{[s.city, s.region, s.country].filter(Boolean).join(', ') || '—'}</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {stationTypeBadge(s.stationType)}
                    {classifBadge(s.classificationLevel)}
                  </div>

                  {(s.latitude || s.longitude) && (
                    <div className="flex items-center gap-1 text-xs text-gray-400 font-mono">
                      <MapPin className="w-3 h-3" />
                      {s.latitude}, {s.longitude}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Floating + button */}
        <button
          onClick={() => setShowCreate(true)}
          className="fixed bottom-8 end-8 w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105 z-40"
        >
          <Plus className="w-6 h-6" />
        </button>

        <CreateStationDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AnimatedPage>
  );
}
