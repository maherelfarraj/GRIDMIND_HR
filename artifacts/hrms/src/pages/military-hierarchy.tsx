import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMilitaryRanks, useCreateMilitaryRank, useDeleteMilitaryRank,
  useListOrgUnits, useCreateOrgUnit, useGetOrgUnitTree,
  useListChainOfCommand, useCreateChainOfCommand, useDeleteChainOfCommand,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Trash2, ChevronRight, ChevronDown, Loader2, Shield } from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────
function catColor(cat: string) {
  const m: Record<string, string> = {
    officer: 'bg-blue-100 text-blue-700', nco: 'bg-green-100 text-green-700',
    enlisted: 'bg-gray-100 text-gray-700', warrant: 'bg-purple-100 text-purple-700',
    civilian: 'bg-orange-100 text-orange-700',
  };
  return m[cat] ?? 'bg-gray-100 text-gray-600';
}

function classifColor(lvl: string) {
  const m: Record<string, string> = {
    unclassified: 'bg-gray-100 text-gray-600', restricted: 'bg-yellow-100 text-yellow-700',
    confidential: 'bg-orange-100 text-orange-700', secret: 'bg-red-100 text-red-700',
    top_secret: 'bg-red-200 text-red-800',
  };
  return m[lvl] ?? 'bg-gray-100 text-gray-600';
}

const UNIT_TYPES = ['command','hq','directorate','formation','brigade','battalion','company','platoon','section','department','division','branch'];
const CLASSIF_LEVELS = ['unclassified','restricted','confidential','secret','top_secret'];
const ORG_TYPES = ['military','government','commercial'];
const RANK_CATEGORIES = ['officer','nco','enlisted','warrant','civilian'];
const RELATIONSHIP_TYPES = ['direct','functional','dotted_line','secondment','acting'];

// ─── Tab: Ranks ───────────────────────────────────────────────────────────────
function RanksTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ranks, isLoading } = useListMilitaryRanks();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    rankCode: '', nameEn: '', nameAr: '', abbreviationEn: '', abbreviationAr: '',
    category: 'officer', rankOrder: '', organizationType: 'military', natoEquivalent: '',
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const createMutation = useCreateMilitaryRank({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listMilitaryRanks'] });
        setShowCreate(false);
        setForm({ rankCode:'', nameEn:'', nameAr:'', abbreviationEn:'', abbreviationAr:'', category:'officer', rankOrder:'', organizationType:'military', natoEquivalent:'' });
        toast({ title: t('Rank created', 'تم إنشاء الرتبة') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const deleteMutation = useDeleteMilitaryRank({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listMilitaryRanks'] });
        toast({ title: t('Rank deleted','تم حذف الرتبة') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('Add Rank','إضافة رتبة')}
        </Button>
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Code','الرمز')}</TableHead>
                    <TableHead>{t('Name EN','الاسم EN')}</TableHead>
                    <TableHead>{t('Name AR','الاسم AR')}</TableHead>
                    <TableHead>{t('Category','الفئة')}</TableHead>
                    <TableHead>{t('NATO','ناتو')}</TableHead>
                    <TableHead>{t('Order','الترتيب')}</TableHead>
                    <TableHead>{t('Org Type','نوع المنظمة')}</TableHead>
                    <TableHead>{t('Active','نشط')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ranks ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-400">{t('No ranks found','لا توجد رتب')}</TableCell></TableRow>
                  ) : (ranks ?? []).map((r: any) => (
                    <TableRow key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="font-mono text-xs">{r.rankCode}</TableCell>
                      <TableCell className="font-medium">{r.nameEn}</TableCell>
                      <TableCell>{r.nameAr}</TableCell>
                      <TableCell><Badge className={cn('text-xs border-transparent', catColor(r.category))}>{r.category}</Badge></TableCell>
                      <TableCell className="text-xs">{r.natoEquivalent ?? '—'}</TableCell>
                      <TableCell>{r.rankOrder}</TableCell>
                      <TableCell className="text-xs">{r.organizationType}</TableCell>
                      <TableCell>
                        <span className={cn('inline-block w-2 h-2 rounded-full', r.isActive ? 'bg-green-500' : 'bg-gray-300')} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                          onClick={() => deleteMutation.mutate({ id: r.id } as any)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('Create Military Rank','إنشاء رتبة عسكرية')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2 max-h-[65vh] overflow-y-auto">
            {([['rankCode','Rank Code','رمز الرتبة'],['nameEn','Name EN','الاسم EN'],['nameAr','Name AR','الاسم AR'],
              ['abbreviationEn','Abbrev EN','اختصار EN'],['abbreviationAr','Abbrev AR','اختصار AR'],
              ['rankOrder','Rank Order','ترتيب الرتبة'],['natoEquivalent','NATO Equivalent','مكافئ ناتو']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input value={form[key as keyof typeof form]} onChange={f(key as keyof typeof form)} placeholder={t(label, labelAr)} />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Category','الفئة')}</label>
              <Select value={form.category} onValueChange={v => setForm(p => ({...p, category: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RANK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Organization Type','نوع المنظمة')}</label>
              <Select value={form.organizationType} onValueChange={v => setForm(p => ({...p, organizationType: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ORG_TYPES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.rankCode || !form.nameEn}
              onClick={() => createMutation.mutate({ data: { ...form, rankOrder: Number(form.rankOrder) || 1 } } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Create','إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tree Node ────────────────────────────────────────────────────────────────
function TreeNode({ node, depth = 0 }: { node: any; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div>
      <div
        className={cn('flex items-center gap-1 py-1 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm')}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />
        ) : <span className="w-3 h-3" />}
        <span className="font-medium">{node.nameEn}</span>
        <span className="text-xs text-gray-400 ml-1">({node.unitCode})</span>
        <Badge className="ml-auto text-[10px] border-transparent bg-gray-100 text-gray-600">{node.unitType}</Badge>
      </div>
      {expanded && hasChildren && node.children.map((child: any) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ─── Tab: Org Units ───────────────────────────────────────────────────────────
function OrgUnitsTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orgUnits, isLoading } = useListOrgUnits();
  const { data: tree } = useGetOrgUnitTree();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    unitCode: '', nameEn: '', nameAr: '', unitType: 'department', organizationType: 'military',
    parentId: '', classificationLevel: 'unclassified', authorizedStrength: '',
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const createMutation = useCreateOrgUnit({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listOrgUnits'] });
        queryClient.invalidateQueries({ queryKey: ['getOrgUnitTree'] });
        setShowCreate(false);
        setForm({ unitCode:'', nameEn:'', nameAr:'', unitType:'department', organizationType:'military', parentId:'', classificationLevel:'unclassified', authorizedStrength:'' });
        toast({ title: t('Org unit created','تم إنشاء الوحدة التنظيمية') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('Add Org Unit','إضافة وحدة تنظيمية')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tree */}
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('Hierarchy Tree','شجرة الهيكل')}</CardTitle></CardHeader>
          <CardContent className="p-2 max-h-96 overflow-y-auto">
            {tree ? (
              Array.isArray(tree) ? tree.map((n: any) => <TreeNode key={n.id} node={n} />) : <TreeNode node={tree} />
            ) : <p className="text-xs text-gray-400 p-2">{t('Loading tree...','جاري تحميل الشجرة...')}</p>}
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="rounded-xl shadow-sm lg:col-span-2">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Code','الرمز')}</TableHead>
                      <TableHead>{t('Name','الاسم')}</TableHead>
                      <TableHead>{t('Type','النوع')}</TableHead>
                      <TableHead>{t('Org Type','نوع المنظمة')}</TableHead>
                      <TableHead>{t('Classification','التصنيف')}</TableHead>
                      <TableHead>{t('Strength','القوة')}</TableHead>
                      <TableHead>{t('Active','نشط')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(orgUnits ?? []).length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t('No units found','لا توجد وحدات')}</TableCell></TableRow>
                    ) : (orgUnits ?? []).map((u: any) => (
                      <TableRow key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <TableCell className="font-mono text-xs">{u.unitCode}</TableCell>
                        <TableCell className="font-medium text-sm">{u.nameEn}</TableCell>
                        <TableCell className="text-xs">{u.unitType}</TableCell>
                        <TableCell className="text-xs">{u.organizationType}</TableCell>
                        <TableCell><Badge className={cn('text-xs border-transparent', classifColor(u.classificationLevel))}>{u.classificationLevel}</Badge></TableCell>
                        <TableCell className="text-xs">{u.authorizedStrength ?? '—'}</TableCell>
                        <TableCell><span className={cn('inline-block w-2 h-2 rounded-full', u.isActive ? 'bg-green-500' : 'bg-gray-300')} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('Create Org Unit','إنشاء وحدة تنظيمية')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2 max-h-[65vh] overflow-y-auto">
            {([['unitCode','Unit Code','رمز الوحدة'],['nameEn','Name EN','الاسم EN'],['nameAr','Name AR','الاسم AR'],
              ['authorizedStrength','Auth. Strength','القوة المصرح بها']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input value={form[key as keyof typeof form]} onChange={f(key as keyof typeof form)} placeholder={t(label, labelAr)} />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Unit Type','نوع الوحدة')}</label>
              <Select value={form.unitType} onValueChange={v => setForm(p => ({...p, unitType: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNIT_TYPES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Organization Type','نوع المنظمة')}</label>
              <Select value={form.organizationType} onValueChange={v => setForm(p => ({...p, organizationType: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ORG_TYPES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Classification Level','مستوى التصنيف')}</label>
              <Select value={form.classificationLevel} onValueChange={v => setForm(p => ({...p, classificationLevel: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CLASSIF_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-xs font-medium text-gray-500">{t('Parent Unit','الوحدة الأم')}</label>
              <Select value={form.parentId} onValueChange={v => setForm(p => ({...p, parentId: v}))}>
                <SelectTrigger><SelectValue placeholder={t('None (root)','لا يوجد (جذر)')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('None (root)','لا يوجد (جذر)')}</SelectItem>
                  {(orgUnits ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.nameEn} ({u.unitCode})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.unitCode || !form.nameEn}
              onClick={() => createMutation.mutate({ data: { ...form, parentId: form.parentId ? Number(form.parentId) : null, authorizedStrength: form.authorizedStrength ? Number(form.authorizedStrength) : null } } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Create','إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab: Chain of Command ────────────────────────────────────────────────────
function ChainOfCommandTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: coc, isLoading } = useListChainOfCommand();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    employeeId: '', supervisorEmployeeId: '', relationshipType: 'direct', effectiveFrom: '',
  });

  const createMutation = useCreateChainOfCommand({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listChainOfCommand'] });
        setShowCreate(false);
        setForm({ employeeId:'', supervisorEmployeeId:'', relationshipType:'direct', effectiveFrom:'' });
        toast({ title: t('Chain of command entry created','تم إنشاء سلسلة القيادة') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  const deleteMutation = useDeleteChainOfCommand({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listChainOfCommand'] });
        toast({ title: t('Entry deleted','تم الحذف') });
      },
      onError: (err: any) => toast({ title: t('Error','خطأ'), description: err?.message, variant:'destructive' }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />{t('Add CoC Entry','إضافة سلسلة قيادة')}
        </Button>
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee','الموظف')}</TableHead>
                    <TableHead>{t('Supervisor','المشرف')}</TableHead>
                    <TableHead>{t('Relationship','العلاقة')}</TableHead>
                    <TableHead>{t('Effective From','من تاريخ')}</TableHead>
                    <TableHead>{t('Active','نشط')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(coc ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">{t('No entries','لا توجد إدخالات')}</TableCell></TableRow>
                  ) : (coc ?? []).filter((c: any) => c.isActive).map((c: any) => (
                    <TableRow key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <TableCell className="text-sm">{c.employeeId}</TableCell>
                      <TableCell className="text-sm">{c.supervisorEmployeeId}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{c.relationshipType?.replace('_',' ')}</Badge></TableCell>
                      <TableCell className="text-sm">{c.effectiveFrom}</TableCell>
                      <TableCell><span className={cn('inline-block w-2 h-2 rounded-full', c.isActive ? 'bg-green-500' : 'bg-gray-300')} /></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                          onClick={() => deleteMutation.mutate({ id: c.id } as any)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={v => !v && setShowCreate(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('Add Chain of Command','إضافة سلسلة قيادة')}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {([['employeeId','Employee ID','رقم الموظف'],['supervisorEmployeeId','Supervisor ID','رقم المشرف'],['effectiveFrom','Effective From','من تاريخ']] as const).map(([key, label, labelAr]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{t(label, labelAr)}</label>
                <Input type={key === 'effectiveFrom' ? 'date' : 'number'} value={form[key as keyof typeof form]}
                  onChange={e => setForm(p => ({...p, [key]: e.target.value}))} />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">{t('Relationship Type','نوع العلاقة')}</label>
              <Select value={form.relationshipType} onValueChange={v => setForm(p => ({...p, relationshipType: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RELATIONSHIP_TYPES.map(r => <SelectItem key={r} value={r}>{r.replace('_',' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('Cancel','إلغاء')}</Button>
            <Button disabled={createMutation.isPending || !form.employeeId || !form.supervisorEmployeeId}
              onClick={() => createMutation.mutate({ data: { employeeId: Number(form.employeeId), supervisorEmployeeId: Number(form.supervisorEmployeeId), relationshipType: form.relationshipType, effectiveFrom: form.effectiveFrom } } as any)}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('Create','إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MilitaryHierarchy() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'ranks'|'orgunits'|'coc'>('ranks');

  const tabs = [
    { key: 'ranks' as const, label: t('Ranks','الرتب') },
    { key: 'orgunits' as const, label: t('Org Units','الوحدات التنظيمية') },
    { key: 'coc' as const, label: t('Chain of Command','سلسلة القيادة') },
  ];

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('Military Hierarchy','الهيكل العسكري')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('Ranks, organizational units, and chain of command','الرتب والوحدات التنظيمية وسلسلة القيادة')}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {tabs.map(tab_ => (
            <button key={tab_.key} onClick={() => setTab(tab_.key)}
              className={cn('px-4 py-2 text-sm font-medium border-b-2 transition-colors', tab === tab_.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
              {tab_.label}
            </button>
          ))}
        </div>

        {tab === 'ranks' && <RanksTab />}
        {tab === 'orgunits' && <OrgUnitsTab />}
        {tab === 'coc' && <ChainOfCommandTab />}
      </div>
    </AnimatedPage>
  );
}
