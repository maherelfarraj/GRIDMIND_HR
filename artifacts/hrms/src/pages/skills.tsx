import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEmployeeSkills,
  useListEmployees,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { BarChart3, User } from 'lucide-react';

// Proficiency level helpers
const PROFICIENCY_LEVELS = ['beginner', 'basic', 'intermediate', 'advanced', 'expert'];

function proficiencyIndex(level?: string | null): number {
  if (!level) return 0;
  const idx = PROFICIENCY_LEVELS.indexOf(level.toLowerCase());
  return idx >= 0 ? idx + 1 : 0;
}

function ProficiencyDot({ level, size = 8 }: { level?: string | null; size?: number }) {
  const idx = proficiencyIndex(level);
  const colors = ['', 'bg-gray-400', 'bg-yellow-400', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500'];
  if (!idx) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          style={{ width: size, height: size }}
          className={cn('rounded-full', i <= idx ? colors[idx] : 'bg-muted')}
        />
      ))}
    </div>
  );
}

function ProficiencyBar({ level }: { level?: string | null }) {
  const idx = proficiencyIndex(level);
  const colors = ['', 'bg-gray-400', 'bg-yellow-400', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500'];
  const labels = ['', 'Beginner', 'Basic', 'Intermediate', 'Advanced', 'Expert'];
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={cn('w-5 h-2 rounded', i <= idx ? colors[idx] : 'bg-muted')}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{labels[idx] || '—'}</span>
    </div>
  );
}

export default function Skills() {
  const { t } = useLanguage();
  const [empFilter, setEmpFilter] = useState('');

  const { data: skillsData, isLoading: skillsLoading } = useListEmployeeSkills({ limit: 500 } as any);
  const { data: empData } = useListEmployees({ limit: 200 } as any);

  const skills = skillsData?.data ?? [];
  const emps = empData?.data ?? [];

  // Derive unique employees and categories from skills
  const empIds = [...new Set(skills.map(s => s.employeeId))];
  const categories = [...new Set(skills.map(s => s.skillCategory).filter(Boolean))] as string[];

  // Filtered employee skills
  const filteredSkills = empFilter
    ? skills.filter(s => String(s.employeeId) === empFilter)
    : skills;

  // Group by employee for skills matrix
  const byEmployee = empIds.reduce<Record<number, typeof skills>>((acc, id) => {
    acc[id] = skills.filter(s => s.employeeId === id);
    return acc;
  }, {});

  function getEmpName(id: number) {
    const e = emps.find(e => e.id === id);
    return e ? `${e.firstNameEn} ${e.lastNameEn}` : `#${id}`;
  }

  // Get best skill in a category for a given employee
  function getBestSkill(empId: number, category: string) {
    const cats = byEmployee[empId] ?? [];
    return cats.find(s => s.skillCategory === category);
  }

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-amber-500" />
            {t('Skills', 'المهارات')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('Skills matrix and employee skill profiles', 'مصفوفة المهارات وملفات مهارات الموظفين')}</p>
        </div>

        <Tabs defaultValue="matrix">
          <TabsList>
            <TabsTrigger value="matrix">{t('Skills Matrix', 'مصفوفة المهارات')}</TabsTrigger>
            <TabsTrigger value="employee">{t('Employee Skills', 'مهارات الموظف')}</TabsTrigger>
          </TabsList>

          {/* Matrix */}
          <TabsContent value="matrix" className="mt-4">
            {skillsLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : empIds.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No skills data available', 'لا توجد بيانات مهارات')}</div>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium text-muted-foreground sticky left-0 bg-card min-w-36">{t('Employee', 'الموظف')}</th>
                        {categories.map(cat => (
                          <th key={cat} className="text-center p-3 font-medium text-muted-foreground min-w-32">{cat}</th>
                        ))}
                        <th className="text-left p-3 font-medium text-muted-foreground min-w-24">{t('Other', 'أخرى')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {empIds.slice(0, 30).map(empId => (
                        <tr key={empId} className="border-b hover:bg-muted/30">
                          <td className="p-3 font-medium sticky left-0 bg-card">{getEmpName(empId)}</td>
                          {categories.map(cat => (
                            <td key={cat} className="p-3 text-center">
                              <div className="flex justify-center">
                                <ProficiencyDot level={getBestSkill(empId, cat)?.proficiencyLevel} />
                              </div>
                            </td>
                          ))}
                          <td className="p-3 text-xs text-muted-foreground">
                            {(byEmployee[empId] ?? []).filter(s => !s.skillCategory).length || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* Employee Skills */}
          <TabsContent value="employee" className="mt-4 space-y-4">
            <Select value={empFilter} onValueChange={setEmpFilter}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t('Select Employee', 'اختر الموظف')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('All Employees', 'جميع الموظفين')}</SelectItem>
                {emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>)}
              </SelectContent>
            </Select>

            {filteredSkills.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">{t('No skills found', 'لا توجد مهارات')}</div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSkills.map(skill => (
                  <Card key={skill.id}>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{skill.skillName}</p>
                          {skill.skillCategory && (
                            <Badge variant="outline" className="text-xs mt-1">{skill.skillCategory}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="w-3 h-3" />
                          {getEmpName(skill.employeeId)}
                        </div>
                      </div>
                      <ProficiencyBar level={skill.proficiencyLevel} />
                      {skill.lastAssessedAt != null && (
                        <p className="text-xs text-muted-foreground">{t('Last assessed', 'آخر تقييم')}: {new Date(skill.lastAssessedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
