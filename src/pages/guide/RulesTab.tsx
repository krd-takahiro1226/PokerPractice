import { Link } from 'react-router-dom';
import { Panel } from '../../components/Panel';
import { PositionTable } from '../../components/PositionTable';
import { ExampleHandWalkthrough } from './ExampleHandWalkthrough';
import { HandRankingsList } from '../../components/HandRankings';

const ACTIONS: { term: string; desc: string }[] = [
  { term: 'fold', desc: '自分の手札を捨てて、そのハンドの勝負から降りる。すでに賭けたチップは戻らない。' },
  { term: 'check', desc: 'そのラウンドで誰もベットしていない時、追加チップを賭けずに手番を次に回す。' },
  { term: 'call', desc: '相手のベット/レイズ額と同じだけチップを出して、勝負を続ける。' },
  { term: 'bet', desc: 'そのラウンドで最初にチップを賭ける行為。' },
  { term: 'raise', desc: '既にあるベットより多く賭けて、相手にコール/フォールド/再レイズを迫る。' },
  { term: 'all-in', desc: '残りのチップを全て賭ける。手持ち以上は賭けられない。' },
];

export function RulesTab() {
  return (
    <div className="space-y-5">
      <Panel title="1. ゲームの目的と基本">
        <div className="space-y-2 text-sm leading-relaxed text-text">
          <p>
            テキサスホールデム（NLH）は、各プレイヤーに配られる 2 枚の手札（ホールカード）と、
            全員で共有する最大 5 枚の共有カード（ボード）を組み合わせ、5 枚で最も強い役を作って勝負するゲームです。
          </p>
          <p>
            プレイヤーはチップを賭け合い、最終的に最も強い役を持つプレイヤーがポット（賭けられたチップの総額）を獲得します。
            また、ベットの駆け引きの途中で自分以外の全員が fold（降りる）すれば、役の強さに関係なくポットを獲得できます。
          </p>
        </div>
      </Panel>

      <Panel title="2. テーブルとポジション" subtitle="席順によって有利さが変わります">
        {/* 図の列は幅を固定する: PositionTable は絶対配置の子しか持たず固有幅が無いため、
            auto 幅の grid 列に置くと潰れて表示が崩れる */}
        <div className="grid gap-5 sm:grid-cols-[1fr_280px] sm:items-center">
          <div className="space-y-2 text-sm leading-relaxed text-text">
            <p>
              テーブルには最大 6 人が着席します。「ディーラーボタン（BTN）」という目印がハンドごとに時計回りへ 1 つずつ移動し、
              誰が形式上のディーラーかを示します。
            </p>
            <p>
              BTN の左隣が SB（スモールブラインド）、その隣が BB（ビッグブラインド）です。この 2 人はカードが配られる前に、
              強制的に一定額のチップ（例: SB は 0.5bb、BB は 1bb）を賭けます。これを「ブラインド」と呼び、
              これによって毎ハンド必ず奪い合うチップがポットに生まれます。
            </p>
            <p>
              なお「bb」はチップ量の単位としても使われます（BB の強制ベット額 = 1bb）。以降、ベット額はこの bb 単位で表記します。
            </p>
            <p>
              6-max（6人卓）では UTG → HJ → CO → BTN → SB → BB の順に手番が回ります。
              UTG は最初にアクションしないといけないため情報が少なく不利、BTN は他の全員のアクションを見てから動けるため最も有利です。
            </p>
            <p>
              後ろに手番が残っている人が多いポジション（UTG など）ほどタイトに（強いハンドだけで）プレイし、
              BTN のように後ろの手番が少ないポジションほど広いレンジで参加できます。
            </p>
          </div>
          <PositionTable hero="BTN" className="w-full max-w-xs" />
        </div>
      </Panel>

      <Panel title="3. アクション一覧">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-4">用語</th>
                <th className="py-2">説明</th>
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map((a) => (
                <tr key={a.term} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 pr-4 font-mono font-semibold text-accent-bright">{a.term}</td>
                  <td className="py-2.5 text-muted">{a.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="4. ゲームの流れ" subtitle="1つの例題ハンドをステップごとに見ていきましょう">
        <ExampleHandWalkthrough />
      </Panel>

      <Panel title="5. 役一覧（強い順）" subtitle="10種類を強い順に並べています。成立条件も合わせて覚えましょう">
        <HandRankingsList />
      </Panel>

      <Panel title="6. 次のステップ">
        <div className="flex flex-wrap items-center gap-3 text-sm text-text">
          <p>
            出てきた用語がわからなくなったら、いつでも{' '}
            <Link to="/glossary" className="font-semibold text-accent-bright hover:underline">
              用語集
            </Link>{' '}
            で調べられます。
          </p>
          <p>ルールがわかったら、次は「アプリの使い方・勉強法」タブでこのアプリの活用方法を見てみましょう。</p>
        </div>
      </Panel>
    </div>
  );
}
