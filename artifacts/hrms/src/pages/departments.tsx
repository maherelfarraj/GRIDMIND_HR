import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { useListDepartments, useGetDepartmentTree, useCreateDepartment } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Network, Plus, Users, List, ChevronRight, Shield, Building2, Briefcase, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

interface Department {
  id: number;
  code: string;
  nameEn: string;
  nameAr: string;
  parentId: number | null;
  headEmployeeId: number | null;
  headEmployeeNameEn: string | null;
  headEmployeeNameAr: string | null;
  organizationType: string;
  employeeCount: number;
  children?: Department[];
}

const EMPTY_FORM = {
  nameEn: '', nameAr: '', code: '',
  organizationType: 'commercial', parentId: '',
};

export default function Departments() {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table');
  const { data: departments, isLoading } = useListDepartments();
  const { data: tree } = useGetDepartmentTree();
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const createDepartment = useCreateDepartment();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createDepartment.mutateAsync({
        data: {
          nameEn: form.nameEn,
          nameAr: form.nameAr,
          code: form.code,
          organizationType: form.organizationType,
          parentId: form.parentId ? Number(form.parentId) : undefined,
        },
      });
      qc.invalidateQueries({ queryKey: ['departments'] });
      setOpen(false);
      setForm(EMPTY_FORM);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create department');
    } finally {
      setSaving(false);
    }
  };

  const toggleNode = (id: number) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) newExpanded.delete(id);
    else newExpanded.add(id);
    setExpandedNodes(newExpanded);
  };

  const expandAll = () => {
    if (!tree) return;
    const allIds = new Set<number>();
    const collectIds = (nodes: { id: number; children?: unknown[] }[]) => {
      nodes.forEach(node => {
        allIds.add(node.id);
        if (node.children?.length) collectIds(node.children as { id: number; children?: unknown[] }[]);
      });
    };
    collectIds(tree);
    setExpandedNodes(allIds);
  };

  const getOrgIcon = (type: string) => {
    switch (type) {
      case 'military': return Shield;
      case 'government': return Building2;
      default: return Briefcase;
    }
  };

  const getOrgColor = (type: string) => {
    switch (type) {
      case 'military': return 'text-amber-500';
      case 'government': return 'text-blue-500';
      default: return 'text-emerald-500';
    }
  };

  type TreeNodeData = { id: number; nameEn: string; nameAr: string; code: string; employeeCount: number; organizationType?: string; children?: unknown[] };
  const TreeNode = ({ node, level = 0 }: { node: TreeNodeData; level?: number }) => {
    const Icon = getOrgIcon(node.organizationType ?? 'commercial');
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div className="relative">
        <div
          className={cn('flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group', level > 0 && 'ms-4')}
          style={{ marginInlineStart: level > 0 ? `${level * 24}px` : '0' }}
        >
          {level > 0 && <div className="absolute start-0 top-0 w-px h-full bg-border" style={{ insetInlineStart: `${(level - 1) * 24 + 12}px` }} />}
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            {hasChildren ? (
              <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} onClick={e => { e.stopPropagation(); toggleNode(node.id); }} />
            ) : <div className="w-4 h-4" />}
          </div>
          <Icon className={cn('w-5 h-5 shrink-0', getOrgColor(node.organizationType ?? 'commercial'))} />
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <span className="font-semibold truncate">{localName(node.nameEn, node.nameAr, lang)}</span>
            <Badge variant="secondary" className="text-xs shrink-0">{node.code}</Badge>
          </div>
          <div className="flex items-center gap-2 ms-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">{node.employeeCount}</span>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {hasChildren && isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              {(node.children as TreeNodeData[]).map(child => <TreeNode key={child.id} node={child} level={level + 1} />)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <AnimatedPage className="space-y-6">
      {/* Create Department Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Add Department', 'إضافة قسم')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('Name (English)', 'الاسم (إنجليزي)')} *</Label>
                <Input value={form.nameEn} onChange={e => setForm(p => ({ ...p, nameEn: e.target.value }))} required placeholder="Human Resources" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Name (Arabic)', 'الاسم (عربي)')} *</Label>
                <Input value={form.nameAr} onChange={e => setForm(p => ({ ...p, nameAr: e.target.value }))} required placeholder="الموارد البشرية" dir="rtl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('Code', 'الرمز')} *</Label>
                <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} required placeholder="HR" maxLength={10} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Type', 'النوع')} *</Label>
                <Select value={form.organizationType} onValueChange={v => setForm(p => ({ ...p, organizationType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">{t('Commercial', 'تجاري')}</SelectItem>
                    <SelectItem value="government">{t('Government', 'حكومي')}</SelectItem>
                    <SelectItem value="military">{t('Military', 'عسكري')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('Parent Department', 'القسم الأعلى')}</Label>
              <Select value={form.parentId} onValueChange={v => setForm(p => ({ ...p, parentId: v }))}>
                <SelectTrigger><SelectValue placeholder={t('None (top-level)', 'لا يوجد')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('None (top-level)', 'لا يوجد')}</SelectItem>
                  {departments?.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>{localName(d.nameEn, d.nameAr, lang)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
              <Button type="submit" disabled={saving}>{saving ? t('Saving…', 'جارٍ الحفظ…') : t('Create', 'إنشاء')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Organization Hierarchy', 'الهيكل التنظيمي')}</h1>
          <p className="text-muted-foreground mt-1">{t('Manage departments, divisions, and reporting lines.', 'إدارة الأقسام والقطاعات وخطوط التقارير.')}</p>
        </div>
        <div className="flex gap-2">
          <div className="flex border rounded-md">
            <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('table')} className="rounded-e-none">
              <List className="w-4 h-4 me-2" />{t('Table', 'جدول')}
            </Button>
            <Button variant={viewMode === 'tree' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('tree')} className="rounded-s-none">
              <Network className="w-4 h-4 me-2" />{t('Tree', 'شجرة')}
            </Button>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4 me-2" />{t('Add Department', 'إضافة قسم')}
          </Button>
        </div>
      </div>

      {viewMode === 'table' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><List className="w-5 h-5" />{t('Departments', 'الأقسام')}</CardTitle>
            <CardDescription>{t('Flat view of all organizational units.', 'عرض مسطح لجميع الوحدات التنظيمية.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Department Name', 'اسم القسم')}</TableHead>
                    <TableHead>{t('Code', 'الرمز')}</TableHead>
                    <TableHead>{t('Parent', 'القسم التابع له')}</TableHead>
                    <TableHead>{t('Head', 'الرئيس')}</TableHead>
                    <TableHead className="text-end">{t('Headcount', 'عدد الموظفين')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><Skeleton className="h-6 w-full" /></TableCell>)}
                    </TableRow>
                  )) : departments?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {t('No departments yet. Click "Add Department" to create one.', 'لا توجد أقسام. انقر على "إضافة قسم" لإنشاء قسم.')}
                      </TableCell>
                    </TableRow>
                  ) : departments?.map(dept => (
                    <TableRow key={dept.id}>
                      <TableCell className="font-medium">
                        {localName(dept.nameEn, dept.nameAr, lang)}
                        {dept.organizationType !== 'commercial' && (
                          <Badge variant="outline" className="ms-2 text-[10px] uppercase">{dept.organizationType}</Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{dept.code}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{(dept as unknown as { parentNameEn?: string }).parentNameEn || '-'}</TableCell>
                      <TableCell>{(dept as unknown as { headEmployeeNameEn?: string }).headEmployeeNameEn || <span className="text-muted-foreground italic">{t('Vacant', 'شاغر')}</span>}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-2">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{(dept as unknown as { employeeCount?: number }).employeeCount ?? 0}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Network className="w-5 h-5" />{t('Organization Tree', 'شجرة المنظمة')}</CardTitle>
                <CardDescription>{t('Hierarchical view of departments and reporting structure.', 'عرض هرمي للأقسام وهيكل التقارير.')}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={expandAll}><ChevronDown className="w-4 h-4 me-2" />{t('Expand All', 'توسيع الكل')}</Button>
                <Button variant="outline" size="sm" onClick={() => setExpandedNodes(new Set())}><ChevronRight className="w-4 h-4 me-2" />{t('Collapse All', 'طي الكل')}</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!tree || tree.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No departments yet.', 'لا توجد أقسام بعد.')}</div>
            ) : (
              <div className="space-y-1">{tree.map(node => <TreeNode key={node.id} node={node as TreeNodeData} />)}</div>
            )}
          </CardContent>
        </Card>
      )}
    </AnimatedPage>
  );
}
