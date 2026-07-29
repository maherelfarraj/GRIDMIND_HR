import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useListDepartments, useGetDepartmentTree } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Network, Plus, Users, List, ChevronRight, Shield, Building2, Briefcase, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

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

export default function Departments() {
  const { t, lang } = useLanguage();
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table');
  const { data: departments, isLoading } = useListDepartments();
  const { data: tree } = useGetDepartmentTree();
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());

  const toggleNode = (id: number) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedNodes(newExpanded);
  };

  const expandAll = () => {
    if (!tree) return;
    const allIds = new Set<number>();
    const collectIds = (nodes: Department[]) => {
      nodes.forEach(node => {
        allIds.add(node.id);
        if (node.children && node.children.length > 0) {
          collectIds(node.children);
        }
      });
    };
    collectIds(tree);
    setExpandedNodes(allIds);
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  const getOrgIcon = (type: string) => {
    switch (type) {
      case 'military': return Shield;
      case 'government': return Building2;
      case 'commercial': return Briefcase;
      default: return Network;
    }
  };

  const getOrgColor = (type: string) => {
    switch (type) {
      case 'military': return 'text-amber-500';
      case 'government': return 'text-blue-500';
      case 'commercial': return 'text-emerald-500';
      default: return 'text-muted-foreground';
    }
  };

  const TreeNode = ({ node, level = 0 }: { node: Department; level?: number }) => {
    const Icon = getOrgIcon(node.organizationType);
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div className="relative">
        <div
          className={cn(
            "flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group",
            level > 0 && "ms-4"
          )}
          style={{ marginInlineStart: level > 0 ? `${level * 24}px` : '0' }}
        >
          {/* Connector line */}
          {level > 0 && (
            <div className="absolute start-0 top-0 w-px h-full bg-border" style={{ insetInlineStart: `${(level - 1) * 24 + 12}px` }} />
          )}

          {/* Toggle chevron */}
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            {hasChildren ? (
              <ChevronRight
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform",
                  isExpanded && "rotate-90"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNode(node.id);
                }}
              />
            ) : (
              <div className="w-4 h-4" />
            )}
          </div>

          {/* Icon */}
          <Icon className={cn("w-5 h-5 shrink-0", getOrgColor(node.organizationType))} />

          {/* Department info */}
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <span className="font-semibold truncate">
              {lang === 'en' ? node.nameEn : node.nameAr}
            </span>
            <Badge variant="secondary" className="text-xs shrink-0">
              {node.code}
            </Badge>
          </div>

          {/* Employee count */}
          <div className="flex items-center gap-2 ms-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">{node.employeeCount}</span>
          </div>
        </div>

        {/* Children */}
        <AnimatePresence initial={false}>
          {hasChildren && isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {node.children!.map((child) => (
                <TreeNode key={child.id} node={child} level={level + 1} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Organization Hierarchy', 'الهيكل التنظيمي')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage departments, divisions, and reporting lines.', 'إدارة الأقسام والقطاعات وخطوط التقارير.')}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex border rounded-md">
            <Button 
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
              className="rounded-e-none"
            >
              <List className="w-4 h-4 me-2" />
              {t('Table', 'جدول')}
            </Button>
            <Button 
              variant={viewMode === 'tree' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('tree')}
              className="rounded-s-none"
            >
              <Network className="w-4 h-4 me-2" />
              {t('Tree', 'شجرة')}
            </Button>
          </div>
          <Button>
            <Plus className="w-4 h-4 me-2" />
            {t('Add Department', 'إضافة قسم')}
          </Button>
        </div>
      </div>

      {viewMode === 'table' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <List className="w-5 h-5" />
              {t('Departments', 'الأقسام')}
            </CardTitle>
            <CardDescription>
              {t('Flat view of all organizational units.', 'عرض مسطح لجميع الوحدات التنظيمية.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-12 ms-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : departments?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      {t('No departments found.', 'لا توجد أقسام.')}
                    </TableCell>
                  </TableRow>
                ) : (
                  departments?.map((dept) => (
                    <TableRow key={dept.id}>
                      <TableCell className="font-medium">
                        {lang === 'en' ? dept.nameEn : dept.nameAr}
                        {dept.organizationType !== 'commercial' && (
                          <Badge variant="outline" className="ms-2 text-[10px] uppercase">
                            {dept.organizationType}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{dept.code}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{dept.parentNameEn || '-'}</TableCell>
                      <TableCell>{dept.headEmployeeNameEn || <span className="text-muted-foreground italic">{t('Vacant', 'شاغر')}</span>}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-2">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{dept.employeeCount}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Network className="w-5 h-5" />
                  {t('Organization Tree', 'شجرة المنظمة')}
                </CardTitle>
                <CardDescription>
                  {t('Hierarchical view of departments and reporting structure.', 'عرض هرمي للأقسام وهيكل التقارير.')}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={expandAll}>
                  <ChevronDown className="w-4 h-4 me-2" />
                  {t('Expand All', 'توسيع الكل')}
                </Button>
                <Button variant="outline" size="sm" onClick={collapseAll}>
                  <ChevronRight className="w-4 h-4 me-2" />
                  {t('Collapse All', 'طي الكل')}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!tree || tree.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {t('No department hierarchy available.', 'لا يوجد تسلسل هرمي للأقسام متاح.')}
              </div>
            ) : (
              <div className="space-y-1">
                {tree.map((node) => (
                  <TreeNode key={node.id} node={node} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </AnimatedPage>
  );
}
