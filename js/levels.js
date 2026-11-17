/* levels.js — 第 1-6 关手写引导关 + 关卡总装配（第 7-100 关由 gen.js 程序化生成）
   图例  . 空  # 实心  = 薄板  ^ 上尖刺  v 悬挂尖刺  < 左尖刺  > 右尖刺
        D 门  P 出生点  X 易碎砖  T 陷阱地板  B 假方块(碰了就消失)
        H 水平移动平台  V 垂直移动平台  C 落锤  G 巡逻守卫  F 飞行怪  W 锯轮  O 酸液
*/
(function () {
  const EMPTY = '........................'; // 24 列

  /* ============ 第 1-6 关：手写引导关 ============ */
  const HAND = [
    {
      name: '新手指引', nameEn: 'Tutorial',
      hint: '← → 移动，空格 / W 跳跃。走上台阶、跳过缺口，抵达发光的门。',
      hintEn: 'Press ← → to move and Space / W to jump. Climb the step, clear the gap, reach the glowing door.',
      tint: ['#0a0c18', '#1a1030'],
      rows: [
        EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
        '..P.....##...........D..',
        '############..##########',
        '############..##########',
      ],
    },
    {
      name: '小心地刺', nameEn: 'Mind the Spikes',
      hint: '地刺一碰就死，跳过去。掉进坑里也会死。',
      hintEn: 'Spikes kill on touch — jump over them. Pits kill too.',
      tint: ['#0d0a12', '#2a0f1c'],
      rows: [
        EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
        '..P...^..............D..',
        '###########..###########',
        '###########..###########',
      ],
    },
    {
      name: '会动的地面', nameEn: 'Moving Ground',
      hint: '有些地方得踩会动的东西过去。',
      hintEn: 'Some gaps can only be crossed on something that moves.',
      tint: ['#08111a', '#0f2438'],
      rows: [
        EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
        '..P.........H........D..',
        '###########...##########',
        '###########...##########',
      ],
    },
    {
      name: '别停下', nameEn: "Don't Stop",
      hint: '易碎的砖踩上去就会裂开——一直往前跑。',
      hintEn: 'Crumbling bricks break under your feet. Just keep running.',
      tint: ['#120e08', '#2b1c0c'],
      rows: [
        EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
        '..P..................D..',
        '##########.XXX.#########',
        '##########.....#########',
      ],
    },
    {
      name: '守卫', nameEn: 'The Guard',
      hint: '守卫来回巡逻，碰到就没命。找好节奏跳过去。',
      hintEn: 'Guards patrol back and forth and kill on contact. Time your jump.',
      tint: ['#0a0d16', '#151a3a'],
      rows: [
        EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
        '..P......^....G....^.D..',
        '########################',
        '########################',
      ],
    },
    {
      name: '门会跑', nameEn: 'The Door Runs',
      hint: '你以为门在等你吗？',
      hintEn: 'Did you think the door was waiting for you?',
      tint: ['#100a12', '#2a1230'],
      rows: [
        EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
        '......D.................',
        '....#####...............',
        '..P...................D.',
        '########################',
        '########################',
      ],
      events: [{ type: 'doorMove', trigger: { tx: 14, ty: 0, tw: 2, th: 14 }, to: { x: 6, y: 9 } }],
    },
  ];

  LD.buildLevels = function () {
    const list = [];
    HAND.forEach((h, i) => list.push({
      id: i + 1, name: h.name, hint: h.hint,
      nameEn: h.nameEn, hintEn: h.hintEn,
      cols: h.rows[0].length,
      grid: h.rows.slice(), events: h.events || [], tint: h.tint, hand: true,
    }));
    for (let id = HAND.length + 1; id <= 100; id++) list.push(LD.genLevel(id));
    return list;
  };

  LD.TOTAL_LEVELS = 100;
})();
