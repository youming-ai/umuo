import { COMPETITIONS } from '../competitions';
import { useT } from '../i18n';
import { navigate, pathFor, type Section, useRouter } from '../utils/router';
import CompetitionSwitcher from './CompetitionSwitcher';
import LanguageSwitcher from './LanguageSwitcher';

const SECTION_TABS: { section: Section; labelKey: string }[] = [
  { section: 'matches', labelKey: 'fixtures.schedule' },
  { section: 'scorers', labelKey: 'fixtures.scorers' },
  { section: 'bracket', labelKey: 'fixtures.bracket' },
];

// `section` is the active schedule section, or undefined on match/team/player
// pages — the tabs still navigate (jump back to a section) but none is marked
// active there.
export default function Header({ section }: { section?: Section }) {
  const t = useT();
  const { route } = useRouter();
  const comp = route.comp;
  const caps = COMPETITIONS[comp]?.capabilities;
  const visibleTabs = SECTION_TABS.filter(
    ({ section }) => section === 'matches' || (caps ? caps[section] : true),
  );
  return (
    // 吸顶。Header 与内容同处一个滚动容器(见 App.tsx)，共享同一条 scrollbar
    // gutter，内边距与下方内容一致(ds-page)即左右对齐，无需补偿。
    <div className="sticky top-0 z-30 bg-night pt-page-y px-page-x md:px-page-x-md">
      <header className="max-w-6xl mx-auto ds-glass md:rounded-panel shadow-panel">
        {/* Narrow screens stack into two rows (logo + language on top, tabs on
            their own full-width row below) so the tab strip never has to scroll;
            sm+ collapses back to a single row (logo | tabs | language). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3 px-3 sm:px-4 py-2 sm:py-0 sm:h-12">
          <h1 className="order-1 flex items-center shrink-0 m-0 leading-none">
            <img
              src="/logo-full.png"
              alt={`STREAMCUP — ${t('brand.subtitle')}`}
              width={40}
              height={40}
              className="h-7 sm:h-9 w-auto object-contain"
            />
          </h1>

          <div className="order-1 shrink-0">
            <CompetitionSwitcher />
          </div>

          <div className="order-3 w-full sm:order-2 sm:w-auto sm:flex-1 flex justify-center min-w-0">
            <nav
              aria-label={t('nav.mainLabel')}
              className="ds-segmented max-w-full overflow-x-auto no-scrollbar"
            >
              {visibleTabs.map(({ section: s, labelKey }) => {
                // The scorers tab reads "Scoring Leaders" for basketball comps
                // (points, not goals) — sport-aware label, same tab/section.
                const label =
                  s === 'scorers' && COMPETITIONS[comp]?.sport === 'basketball'
                    ? 'fixtures.leaders'
                    : labelKey;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => navigate(pathFor({ kind: 'section', comp, section: s }))}
                    aria-pressed={section === s}
                    className={`whitespace-nowrap ds-seg-tab ${
                      section === s ? 'ds-seg-tab-active' : 'ds-seg-tab-inactive'
                    }`}
                  >
                    {t(label)}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="order-2 ml-auto flex items-center gap-0.5 shrink-0 sm:order-3 sm:ml-0">
            <LanguageSwitcher />
          </div>
        </div>
      </header>
    </div>
  );
}
