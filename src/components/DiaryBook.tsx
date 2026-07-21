import { forwardRef, useMemo, useRef, useState } from "react";
import { BookOpenText, ChevronLeft, ChevronRight, Feather, Stamp } from "lucide-react";
import HTMLFlipBook from "react-pageflip";
import ReactMarkdown from "react-markdown";
import { formatDiaryDate } from "../lib/format";
import type { DiaryEntry } from "../types";

type DiaryFilter = "all" | "correction" | "reward";

interface FlipBookHandle {
  pageFlip: () => {
    flipNext: (corner?: "top" | "bottom") => void;
    flipPrev: (corner?: "top" | "bottom") => void;
  };
}

export function DiaryBook({ diaries, dataDir }: { diaries: DiaryEntry[]; dataDir: string }) {
  const [filter, setFilter] = useState<DiaryFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const bookRef = useRef<FlipBookHandle | null>(null);
  const filtered = useMemo(
    () =>
      diaries.filter((diary) => {
        if (filter === "reward") return diary.kind.includes("奖励");
        if (filter === "correction") return diary.kind.includes("挨打");
        return true;
      }),
    [diaries, filter],
  );
  const databaseName = `${dataDir.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/")}/vibekarma.sqlite3`;
  const pageCount = filtered.length + 2;

  return (
    <section className="diary-stage">
      <header className="diary-toolbar">
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
                setCurrentPage(1);
              }}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
        <span>{filtered.length} 篇</span>
      </header>

      <div className="book-area">
        <button
          className="book-nav book-nav--previous"
          type="button"
          onClick={() => bookRef.current?.pageFlip().flipPrev("bottom")}
          aria-label="上一页"
          title="上一页"
        >
          <ChevronLeft size={23} />
        </button>

        <HTMLFlipBook
          key={`${filter}-${filtered.length}`}
          ref={bookRef}
          className="flip-book"
          style={{}}
          width={390}
          height={520}
          size="stretch"
          minWidth={280}
          maxWidth={400}
          minHeight={390}
          maxHeight={530}
          startPage={Math.min(1, pageCount - 1)}
          drawShadow
          flippingTime={720}
          usePortrait
          startZIndex={0}
          autoSize
          maxShadowOpacity={0.34}
          showCover
          mobileScrollSupport
          clickEventForward
          useMouseEvents
          swipeDistance={28}
          showPageCorners
          disableFlipByClick={false}
          onFlip={(event) => setCurrentPage(Number(event.data))}
        >
          <DiaryPage variant="cover">
            <div className="book-cover__ornament"><BookOpenText size={44} /></div>
            <p>VIBEKARMA</p>
            <h1>Codex 的反省日记</h1>
            <span>{databaseName}</span>
          </DiaryPage>

          {filtered.length ? (
            filtered.map((diary, index) => (
              <DiaryPage
                diary={diary}
                number={index + 1}
                variant={diary.kind.includes("奖励") ? "reward" : diary.kind.includes("挨打") ? "correction" : "plain"}
                key={diary.id}
              />
            ))
          ) : (
            <DiaryPage variant="empty">
              <Feather size={32} />
              <h2>这一页还是空白</h2>
            </DiaryPage>
          )}

          <DiaryPage variant="back">
            <Feather size={30} />
            <strong>每一次反馈都会留下痕迹</strong>
          </DiaryPage>
        </HTMLFlipBook>

        <button
          className="book-nav book-nav--next"
          type="button"
          onClick={() => bookRef.current?.pageFlip().flipNext("bottom")}
          aria-label="下一页"
          title="下一页"
        >
          <ChevronRight size={23} />
        </button>
      </div>

      <footer className="book-progress">
        <span />
        <strong>{Math.min(currentPage + 1, pageCount)} / {pageCount}</strong>
        <span />
      </footer>
    </section>
  );
}

interface DiaryPageProps {
  children?: React.ReactNode;
  diary?: DiaryEntry;
  number?: number;
  variant: "cover" | "back" | "empty" | "reward" | "correction" | "plain";
}

const DiaryPage = forwardRef<HTMLDivElement, DiaryPageProps>(function DiaryPage(
  { children, diary, number, variant },
  ref,
) {
  if (!diary) {
    return (
      <div className={`diary-page diary-page--${variant}`} ref={ref} data-density="hard">
        <div className="diary-page__special">{children}</div>
      </div>
    );
  }

  const bodyLength = diary.body.replace(/\s/g, "").length;
  const density = bodyLength > 420 ? "compact" : bodyLength > 280 ? "dense" : "standard";

  return (
    <article className={`diary-page diary-page--${variant} diary-page--${density}`} ref={ref}>
      <div className="paper-lines" aria-hidden="true" />
      <header className="diary-page__header">
        <div>
          <p>{diary.kind}</p>
          <time>{formatDiaryDate(diary.createdAt)}</time>
        </div>
        <span className="diary-page__stamp">
          {variant === "reward" ? <Stamp size={22} /> : <Feather size={22} />}
        </span>
      </header>
      <h2>{diary.title}</h2>
      <div className="diary-page__body">
        <ReactMarkdown>{diary.body}</ReactMarkdown>
      </div>
      <footer>
        <span>{diary.generatedByCodex ? "Codex 亲笔" : "VibeKarma 代笔"}</span>
        <strong>{number}</strong>
      </footer>
    </article>
  );
});
