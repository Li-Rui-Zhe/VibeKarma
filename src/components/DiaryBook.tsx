import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Feather,
} from "lucide-react";
import HTMLFlipBook from "react-pageflip";
import ReactMarkdown from "react-markdown";
import diaryBackCover from "../assets/diary-cover-back.png";
import diaryFrontCover from "../assets/diary-cover-front.png";
import { formatDiaryDate } from "../lib/format";
import type { DiaryEntry } from "../types";

type DiaryFilter = "all" | "correction" | "reward";
type DiaryVariant = "reward" | "correction" | "plain";

interface DiarySheet {
  type: "diary";
  id: string;
  diary: DiaryEntry;
  body: string;
  partIndex: number;
  hasNextPart: boolean;
  variant: DiaryVariant;
  pageNumber: number;
}

interface BlankSheet {
  type: "blank";
  id: string;
}

type BookSheet = DiarySheet | BlankSheet;

const DIARY_PAGE_CHAR_LIMIT = 330;
const PARAGRAPH_LAYOUT_COST = 8;
const MIN_PAGE_FRAGMENT = 18;
const PAGE_FOOTER_CLEARANCE = 12;
const measuredPaginationCache = new Map<string, string[]>();

interface FlipBookHandle {
  pageFlip: () => {
    flipNext: (corner?: "top" | "bottom") => void;
    flipPrev: (corner?: "top" | "bottom") => void;
    turnToPage: (page: number) => void;
  };
}

interface BookLayout {
  sheets: BookSheet[];
  latestPage: number;
  openSpreadLeftPage: number;
  contentPageCount: number;
  physicalPageCount: number;
  key: string;
}

interface DiaryBookProps {
  diaries: DiaryEntry[];
  dataDir: string;
  onBack: () => void;
}

export function DiaryBook({ diaries, dataDir: _dataDir, onBack }: DiaryBookProps) {
  const [filter, setFilter] = useState<DiaryFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const bookRef = useRef<FlipBookHandle | null>(null);
  const filtered = useMemo(
    () =>
      diaries
        .filter((diary) => {
          if (filter === "reward") return diary.kind.includes("奖励");
          if (filter === "correction") return diary.kind.includes("挨打");
          return true;
        })
        .slice()
        .reverse(),
    [diaries, filter],
  );
  const estimatedBookLayout = useMemo(() => buildBookSheets(filtered), [filtered]);
  const [bookLayout, setBookLayout] = useState(estimatedBookLayout);
  const progress = getBookProgress(bookLayout, currentPage);
  const firstContentPage = getFirstContentSpreadPage(bookLayout);
  const lastContentPage = getLastContentSpreadPage(bookLayout);

  useEffect(() => {
    let cancelled = false;
    setBookLayout(estimatedBookLayout);

    const measure = async () => {
      if ("fonts" in document) await document.fonts.ready;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (cancelled) return;
      setBookLayout(buildBookSheets(filtered, paginateDiaryForRenderedPage));
    };

    void measure();
    return () => {
      cancelled = true;
    };
  }, [estimatedBookLayout, filtered]);

  useEffect(() => {
    setCurrentPage(bookLayout.openSpreadLeftPage);
  }, [bookLayout.openSpreadLeftPage]);

  return (
    <section className="diary-stage">
      <div className="book-shell">
        <header className="book-shell__toolbar">
          <button className="book-shell__back" type="button" onClick={onBack} title="返回" aria-label="返回">
            <ChevronLeft size={19} />
          </button>

          <strong className="book-shell__title">Codex 的反省日记</strong>

          <div className="diary-filters" role="tablist" aria-label="日记筛选">
            {([
              ["all", "全部"],
              ["correction", "挨打"],
              ["reward", "奖励"],
            ] as const).map(([value, label]) => (
              <button
                className={filter === value ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => {
                  setFilter(value);
                }}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="book-shell__count">{filtered.length} 篇</span>
          <button
            className="book-shell__diary-command"
            type="button"
            onClick={onBack}
            title="返回控制台"
            aria-label={`反省日记，${diaries.length} 篇；返回控制台`}
          >
            <BookOpenText size={18} />
            <span>反省日记</span>
            <b>{diaries.length}</b>
          </button>
        </header>

        <div className="book-area">
          <button
            className="book-nav book-nav--previous"
            type="button"
            onClick={() => bookRef.current?.pageFlip().flipPrev("top")}
            disabled={currentPage <= 0}
            aria-label="上一页"
            title="上一页"
          >
            <ChevronLeft size={23} />
          </button>

          <HTMLFlipBook
            key={`diary-book-${filter}-${bookLayout.key}`}
            ref={bookRef}
            className="flip-book"
            style={{}}
            width={400}
            height={520}
            size="fixed"
            minWidth={400}
            maxWidth={400}
            minHeight={520}
            maxHeight={520}
            startPage={bookLayout.latestPage}
            drawShadow
            flippingTime={720}
            usePortrait={false}
            startZIndex={0}
            autoSize
            maxShadowOpacity={0.28}
            showCover
            mobileScrollSupport
            clickEventForward
            useMouseEvents
            swipeDistance={28}
            showPageCorners={false}
            disableFlipByClick={false}
            onFlip={(event) => setCurrentPage(Number(event.data))}
          >
            <DiaryPage variant="cover">
              <img
                className="book-cover__image"
                src={diaryFrontCover}
                alt="Codex 的反省日记封面"
                draggable={false}
              />
            </DiaryPage>

            {filtered.length ? (
              bookLayout.sheets.map((sheet) =>
                sheet.type === "blank" ? (
                  <DiaryPage variant="blank" key={sheet.id} />
                ) : (
                  <DiaryPage
                    diary={sheet.diary}
                    body={sheet.body}
                    number={sheet.pageNumber}
                    partIndex={sheet.partIndex}
                    hasNextPart={sheet.hasNextPart}
                    variant={sheet.variant}
                    key={sheet.id}
                  />
                ),
              )
            ) : ([
                <DiaryPage variant="empty" key="empty-diary-page">
                  <Feather size={32} />
                  <h2>这一页还是空白</h2>
                </DiaryPage>,
                <DiaryPage variant="blank" key="empty-back-flyleaf" />,
              ])}

            <DiaryPage variant="back">
              <img
                className="book-cover__image"
                src={diaryBackCover}
                alt="Codex 的反省日记封底"
                draggable={false}
              />
            </DiaryPage>
          </HTMLFlipBook>

          <button
            className="book-nav book-nav--next"
            type="button"
            onClick={() => bookRef.current?.pageFlip().flipNext("top")}
            disabled={currentPage >= bookLayout.physicalPageCount - 1}
            aria-label="下一页"
            title="下一页"
          >
            <ChevronRight size={23} />
          </button>
        </div>

        <footer className="book-shell__footer">
          <span className="book-shell__ribbon book-shell__ribbon--reward" aria-hidden="true" />
          <button
            className="book-page-jump book-first-page"
            type="button"
            onClick={() => {
              if (firstContentPage === null) return;
              bookRef.current?.pageFlip().turnToPage(firstContentPage);
              setCurrentPage(firstContentPage);
            }}
            disabled={firstContentPage === null || currentPage === firstContentPage}
            aria-label="跳转到第一面正文"
            title="跳转到第一面正文"
          >
            <ChevronsLeft size={14} />
            <span>第一页</span>
          </button>
          <div className="book-progress">
            <span />
            <strong aria-live="polite">{progress ? `${progress.current} / ${progress.total}` : ""}</strong>
            <span />
          </div>
          <button
            className="book-page-jump book-last-page"
            type="button"
            onClick={() => {
              if (lastContentPage === null) return;
              bookRef.current?.pageFlip().turnToPage(lastContentPage);
              setCurrentPage(lastContentPage);
            }}
            disabled={lastContentPage === null || currentPage === lastContentPage}
            aria-label="跳转到最后一面正文"
            title="跳转到最后一面正文"
          >
            <span>最后一页</span>
            <ChevronsRight size={14} />
          </button>
          <span className="book-shell__ribbon book-shell__ribbon--correction" aria-hidden="true" />
        </footer>
      </div>
    </section>
  );
}

interface DiaryPageProps {
  children?: React.ReactNode;
  diary?: DiaryEntry;
  body?: string;
  number?: React.ReactNode;
  partIndex?: number;
  hasNextPart?: boolean;
  variant: "cover" | "back" | "empty" | "blank" | DiaryVariant;
}

const DiaryPage = forwardRef<HTMLDivElement, DiaryPageProps>(function DiaryPage(
  { children, diary, body, number, partIndex = 0, hasNextPart = false, variant },
  ref,
) {
  if (!diary) {
    if (variant === "blank") {
      return (
        <div className="diary-page diary-page--blank" ref={ref}>
          <div className="paper-lines" aria-hidden="true" />
        </div>
      );
    }
    return (
      <div className={`diary-page diary-page--${variant}`} ref={ref} data-density="hard">
        <div className="diary-page__special">{children}</div>
      </div>
    );
  }

  const pageBody = body ?? diary.body;
  return (
    <article className={`diary-page diary-page--${variant} diary-page--standard`} ref={ref}>
      <div className="paper-lines" aria-hidden="true" />
      <header className="diary-page__header">
        <span className="diary-page__header-accent" aria-hidden="true" />
        <div>
          <p>{diary.kind}</p>
          <time>{formatDiaryDate(diary.createdAt)}</time>
        </div>
      </header>
      <h2>{diary.title}{partIndex > 0 ? "（续）" : ""}</h2>
      <div className={`diary-page__body${hasNextPart ? " diary-page__body--has-continuation" : ""}`}>
        <ReactMarkdown>{pageBody}</ReactMarkdown>
        {hasNextPart ? (
          <span className="diary-page__continue" title="下一页还有后续" aria-label="下一页还有后续">
            <span>还有后续</span>
            <b aria-hidden="true">…</b>
          </span>
        ) : null}
      </div>
      <footer>
        <span>{diary.generatedByCodex ? "Codex 亲笔" : "VibeKarma 代笔"}</span>
        <strong>{number}</strong>
      </footer>
    </article>
  );
});

export function buildBookSheets(
  diaries: DiaryEntry[],
  paginator: (diary: DiaryEntry) => string[] = (diary) => paginateDiaryBody(diary.body),
): BookLayout {
  if (!diaries.length) {
    return {
      sheets: [] as BookSheet[],
      latestPage: 1,
      openSpreadLeftPage: 1,
      contentPageCount: 0,
      physicalPageCount: 4,
      key: "empty",
    };
  }

  const groups = diaries.map((diary) => {
    const parts = paginator(diary);
    const variant: DiaryVariant = diary.kind.includes("奖励")
      ? "reward"
      : diary.kind.includes("挨打")
        ? "correction"
        : "plain";
    return parts.map<DiarySheet>((body, partIndex) => ({
      type: "diary",
      id: `${diary.id}-part-${partIndex}`,
      diary,
      body,
      partIndex,
      hasNextPart: partIndex < parts.length - 1,
      variant,
      pageNumber: 0,
    }));
  });

  const latestGroupIndex = groups.length - 1;
  let latestSheetIndex = groups
    .slice(0, latestGroupIndex)
    .reduce((total, group) => total + group.length, 0);
  const sheets: BookSheet[] = groups.flat();

  // 封面是第 0 页；展开后奇数页在左、偶数页在右。
  // 若最新日记原本会落在左侧，只在整本日记最前面加一张扉页。
  // 这样既能让上一篇在左、刚写的日记在右，也不会在最近日记之间夹空白页。
  if ((latestSheetIndex + 1) % 2 !== 0) {
    sheets.unshift({
      type: "blank",
      id: `front-flyleaf-${diaries.at(-1)?.id ?? "diary"}`,
    });
    latestSheetIndex += 1;
  }

  let contentPageCount = 0;
  for (const sheet of sheets) {
    if (sheet.type === "diary") {
      contentPageCount += 1;
      sheet.pageNumber = contentPageCount;
    }
  }

  // showCover 只会在封底位于奇数物理索引时把它单独合上。
  // 正文张数为奇数时补一张不编号的后衬页，避免封底与最后一页正文并排出现。
  if (sheets.length % 2 !== 0) {
    sheets.push({
      type: "blank",
      id: `back-flyleaf-${diaries.at(-1)?.id ?? "diary"}`,
    });
  }

  const latestPage = latestSheetIndex + 1;
  return {
    sheets,
    latestPage,
    openSpreadLeftPage: Math.max(1, latestPage - 1),
    contentPageCount,
    physicalPageCount: sheets.length + 2,
    key: diaries.map((diary) => diary.id).join("-") + "-" + sheets.map((sheet) => (
      sheet.type === "diary" ? sheet.body.length : "blank"
    )).join("-"),
  };
}

export function getBookProgress(layout: BookLayout, physicalPage: number) {
  const backCoverPage = layout.physicalPageCount - 1;
  if (layout.contentPageCount === 0 || physicalPage <= 0 || physicalPage >= backCoverPage) {
    return null;
  }

  const visibleNumbers = [physicalPage, physicalPage + 1]
    .map((page) => layout.sheets[page - 1])
    .filter((sheet): sheet is DiarySheet => sheet?.type === "diary")
    .map((sheet) => sheet.pageNumber);
  if (!visibleNumbers.length) return null;

  return {
    current: Math.max(...visibleNumbers),
    total: layout.contentPageCount,
  };
}

export function getFirstContentSpreadPage(layout: BookLayout) {
  const sheetIndex = layout.sheets.findIndex((sheet) => sheet.type === "diary");
  if (sheetIndex < 0) return null;

  const physicalPage = sheetIndex + 1;
  return physicalPage % 2 === 0 ? physicalPage - 1 : physicalPage;
}

export function getLastContentSpreadPage(layout: BookLayout) {
  let sheetIndex = layout.sheets.length - 1;
  while (sheetIndex >= 0 && layout.sheets[sheetIndex]?.type !== "diary") {
    sheetIndex -= 1;
  }
  if (sheetIndex < 0) return null;

  const physicalPage = sheetIndex + 1;
  return physicalPage % 2 === 0 ? physicalPage - 1 : physicalPage;
}

export function paginateDiaryBody(body: string): string[] {
  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (!paragraphs.length) return [body.trim()];

  const pages: string[] = [];
  let current: string[] = [];
  let currentCost = 0;

  const flush = () => {
    if (!current.length) return;
    pages.push(current.join("\n\n"));
    current = [];
    currentCost = 0;
  };

  for (const originalParagraph of paragraphs) {
    let paragraph = originalParagraph;
    while (paragraph) {
      const paragraphCost = countVisibleChars(paragraph);
      const separatorCost = current.length ? PARAGRAPH_LAYOUT_COST : 0;
      const available = DIARY_PAGE_CHAR_LIMIT - currentCost - separatorCost;

      if (paragraphCost <= available) {
        current.push(paragraph);
        currentCost += paragraphCost + separatorCost;
        break;
      }

      if (current.length && available < MIN_PAGE_FRAGMENT) {
        flush();
        continue;
      }

      const [chunk, rest] = takePageChunk(paragraph, Math.max(available, 1));
      current.push(chunk);
      flush();
      paragraph = rest;
    }
  }

  flush();
  return pages.length ? pages : [body.trim()];
}

function takePageChunk(text: string, limit: number): [string, string] {
  let visible = 0;
  let hardBreak = text.length;
  let softBreak = -1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (!/\s/.test(character)) visible += 1;
    if (visible >= Math.max(1, limit - 18) && /[。！？!?；;]/.test(character)) {
      softBreak = index + 1;
    }
    if (visible >= limit) {
      hardBreak = index + 1;
      break;
    }
  }

  const breakAt = softBreak > 0 ? softBreak : hardBreak;
  return [text.slice(0, breakAt).trim(), text.slice(breakAt).trim()];
}

function countVisibleChars(text: string) {
  return text.replace(/\s/g, "").length;
}

function paginateDiaryForRenderedPage(diary: DiaryEntry): string[] {
  const source = diary.body.replace(/\r\n?/g, "\n").trim();
  if (!source || typeof document === "undefined") return [source];
  const cacheKey = diary.id + "\u0000" + diary.title + "\u0000" + source;
  const cached = measuredPaginationCache.get(cacheKey);
  if (cached) return cached.slice();

  const variant: DiaryVariant = diary.kind.includes("奖励")
    ? "reward"
    : diary.kind.includes("挨打")
      ? "correction"
      : "plain";
  const page = document.createElement("article");
  page.className = "diary-page diary-page--" + variant + " diary-page--standard diary-page--measure";

  const header = document.createElement("header");
  header.className = "diary-page__header";
  const accent = document.createElement("span");
  accent.className = "diary-page__header-accent";
  const metadata = document.createElement("div");
  const kind = document.createElement("p");
  kind.textContent = diary.kind;
  const time = document.createElement("time");
  time.textContent = formatDiaryDate(diary.createdAt);
  metadata.append(kind, time);
  header.append(accent, metadata);

  const title = document.createElement("h2");
  const body = document.createElement("div");
  body.className = "diary-page__body";
  const footer = document.createElement("footer");
  const author = document.createElement("span");
  author.textContent = diary.generatedByCodex ? "Codex 亲笔" : "VibeKarma 代笔";
  const pageNumber = document.createElement("strong");
  pageNumber.textContent = "88";
  footer.append(author, pageNumber);
  page.append(header, title, body, footer);
  document.body.append(page);

  const pages: string[] = [];
  let remaining = source;
  let partIndex = 0;

  try {
    while (remaining) {
      title.textContent = diary.title + (partIndex > 0 ? "（续）" : "");
      let low = 1;
      let high = remaining.length;
      let best = 0;

      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = remaining.slice(0, middle).trimEnd();
        const hasNextPart = remaining.slice(middle).trim().length > 0;
        renderMeasuredDiaryBody(body, candidate, hasNextPart);

        const footerTop = footer.getBoundingClientRect().top;
        const bodyBottom = body.getBoundingClientRect().bottom;
        if (bodyBottom <= footerTop - PAGE_FOOTER_CLEARANCE) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      const maximumBreak = Math.max(1, best);
      const breakAt = best >= remaining.length
        ? remaining.length
        : findNearbyReadingBreak(remaining, maximumBreak);
      pages.push(remaining.slice(0, breakAt).trim());
      remaining = remaining.slice(breakAt).trim();
      partIndex += 1;
    }
  } finally {
    page.remove();
  }

  const result = pages.length ? pages : [source];
  measuredPaginationCache.set(cacheKey, result);
  return result.slice();
}

function renderMeasuredDiaryBody(container: HTMLDivElement, text: string, hasNextPart: boolean) {
  container.replaceChildren();
  container.classList.toggle("diary-page__body--has-continuation", hasNextPart);

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  for (const paragraph of paragraphs) {
    const element = document.createElement("p");
    element.textContent = paragraph;
    container.append(element);
  }

  if (hasNextPart) {
    const continuation = document.createElement("span");
    continuation.className = "diary-page__continue";
    const label = document.createElement("span");
    label.textContent = "还有后续";
    const dots = document.createElement("b");
    dots.textContent = "…";
    continuation.append(label, dots);
    container.append(continuation);
  }
}

function findNearbyReadingBreak(text: string, maximum: number) {
  const minimum = Math.max(1, maximum - 14);
  for (let index = maximum; index >= minimum; index -= 1) {
    if (/[。！？!?；;]/.test(text[index - 1] ?? "")) return index;
  }
  for (let index = maximum; index >= minimum; index -= 1) {
    if (/\s/.test(text[index - 1] ?? "")) return index;
  }
  return maximum;
}
