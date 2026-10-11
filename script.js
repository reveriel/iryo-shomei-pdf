/* =========================================================
   医療証明書類 作成ツール — script.js
   純粋なフロントエンドのみ。外部通信は行いません。
   （領収書・診療明細書・診断書の3通を1フォームから生成）
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     ユーティリティ
     --------------------------------------------------------- */

  // 全角英数字・記号を半角に正規化
  function toHalfWidth(str) {
    return String(str)
      .replace(/[！-～]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/　/g, ' ');
  }

  // 通貨・点数文字列 → 数値
  function parseMoney(str) {
    if (str === null || str === undefined) return 0;
    var cleaned = toHalfWidth(String(str)).replace(/[^\d.-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  // 0以上の整数にまるめる
  function toAmount(str) {
    var n = Math.round(parseMoney(str));
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  // 数値 → 千分位カンマ
  function comma(n) {
    var rounded = Math.round(Number(n) || 0);
    var neg = rounded < 0;
    var s = String(Math.abs(rounded));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  // 数値 → ¥1,234
  function yen(n) {
    return '¥' + comma(n);
  }

  // "2026-10-11" → "2026年10月11日"
  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // 生年月日と基準日から満年齢を求める
  function computeAge(birthISO, refISO) {
    var b = parseISO(birthISO);
    if (!b) return null;
    var r = parseISO(refISO) || new Date();
    var age = r.getFullYear() - b.getFullYear();
    var m = r.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && r.getDate() < b.getDate())) age -= 1;
    return age >= 0 ? age : null;
  }

  var KANJI_DIGITS = ['零', '壱', '弐', '参', '肆', '伍', '陸', '漆', '捌', '玖'];
  var KANJI_SMALL = ['', '拾', '百', '阡'];
  var KANJI_BIG = ['', '萬', '億', '兆'];

  // 整数 → 大字（漢数字）表記。例: 1827 → "壱阡捌百弐拾漆"
  function kanjiNumber(n) {
    var num = Math.floor(Math.abs(Number(n) || 0));
    if (num === 0) return '零';

    var out = '';
    var groupIndex = 0;

    while (num > 0) {
      var group = num % 10000;
      if (group > 0) {
        var groupStr = '';
        var g = group;
        var unitIndex = 0;
        while (g > 0) {
          var digit = g % 10;
          if (digit > 0) groupStr = KANJI_DIGITS[digit] + KANJI_SMALL[unitIndex] + groupStr;
          g = Math.floor(g / 10);
          unitIndex += 1;
        }
        out = groupStr + KANJI_BIG[groupIndex] + out;
      }
      num = Math.floor(num / 10000);
      groupIndex += 1;
    }

    return out;
  }

  function $(id) { return document.getElementById(id); }

  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function placeholder(text) {
    return '<span class="ph">' + escapeHtml(text) + '</span>';
  }

  // 今日から days 日ずらした日付（ISO）。サンプルの診察日・療養期間などに使う。
  function shiftISO(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  /* ---------------------------------------------------------
     SVG 円形印章ジェネレーター
     医療機関名を円弧に沿って配置し、中心に医師名（または「医療機関之印」）を
     縦組みで置いた朱色の丸印を生成する。三通の押印欄に描画する。
     --------------------------------------------------------- */

  var SEAL_COLOR = '#c0392b';
  var sealSeq = 0;

  // 円弧に沿わせる文字のサイズ（文字数が多いほど小さく）
  function arcFontSize(len) {
    if (len <= 5) return 9.5;
    if (len <= 8) return 8.4;
    if (len <= 11) return 7.4;
    if (len <= 14) return 6.5;
    return 5.8;
  }

  // 中心（縦組み）の文字サイズ。収まる範囲に丸める。
  function centerFontSize(count) {
    var base;
    if (count <= 2) base = 14;
    else if (count === 3) base = 12;
    else if (count === 4) base = 10.5;
    else if (count === 5) base = 9;
    else base = 7.6;
    var maxH = 46; // 中心に使える高さ
    return Math.min(base, maxH / Math.max(count, 1) / 1.02);
  }

  // 五芒星のパス（中心 50, y、半径 r）
  function starPath(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 10; i += 1) {
      var rad = (i % 2 === 0) ? r : r * 0.42;
      var ang = -Math.PI / 2 + i * Math.PI / 5;
      pts.push((cx + rad * Math.cos(ang)).toFixed(2) + ',' + (cy + rad * Math.sin(ang)).toFixed(2));
    }
    return 'M' + pts.join('L') + 'Z';
  }

  function buildSealSVG(instName, doctorName) {
    var uid = 'sealArc' + (++sealSeq);
    var name = String(instName || '').trim();
    var doctor = String(doctorName || '').trim();
    var center = doctor || '医療機関之印';

    var parts = [];
    parts.push('<svg class="seal-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" ' +
      'xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="印" focusable="false">');

    // 円弧テキスト用のパス（上部の半円・左→上→右）
    parts.push('<defs><path id="' + uid + '" d="M16 50 A34 34 0 0 1 50 16 A34 34 0 0 1 84 50"/></defs>');

    // 外枠（二重丸）
    parts.push('<circle cx="50" cy="50" r="46" fill="none" stroke="' + SEAL_COLOR + '" stroke-width="2.8"/>');
    parts.push('<circle cx="50" cy="50" r="40.5" fill="none" stroke="' + SEAL_COLOR + '" stroke-width="1.1"/>');

    // 医療機関名を円弧に沿って配置
    if (name) {
      var fs = arcFontSize(name.length);
      var textLen = Math.min(name.length * fs * 1.14, 100).toFixed(2);
      parts.push('<text font-size="' + fs + '" font-weight="700" fill="' + SEAL_COLOR +
        '" font-family="\'Noto Sans JP\', sans-serif">' +
        '<textPath href="#' + uid + '" xlink:href="#' + uid + '" startOffset="50%" ' +
        'text-anchor="middle" textLength="' + textLen + '" lengthAdjust="spacingAndGlyphs">' +
        escapeHtml(name) + '</textPath></text>');
    }

    // 中心：医師名（縦組み）または「医療機関之印」
    var chars = center.split('');
    var cfs = centerFontSize(chars.length);
    var step = cfs * 1.02;
    var startY = 50 - (chars.length * step) / 2 + cfs * 0.74;
    chars.forEach(function (ch, i) {
      if (ch === ' ') return;
      parts.push('<text x="50" y="' + (startY + i * step).toFixed(2) + '" text-anchor="middle" ' +
        'font-size="' + cfs.toFixed(2) + '" font-weight="700" fill="' + SEAL_COLOR +
        '" font-family="\'Noto Sans JP\', sans-serif">' + escapeHtml(ch) + '</text>');
    });

    // 下部の五芒星（装飾）
    parts.push('<path d="' + starPath(50, 81, 4.6) + '" fill="' + SEAL_COLOR + '"/>');

    parts.push('</svg>');
    return parts.join('');
  }

  // 要素に値を入れる。空なら薄いプレースホルダを表示（印刷時は消える）
  function setVal(el, text, phText) {
    if (!el) return;
    var t = (text === null || text === undefined) ? '' : String(text).trim();
    if (t) {
      el.textContent = t;
    } else {
      el.innerHTML = placeholder(phText || '未入力');
    }
  }

  /* ---------------------------------------------------------
     表示言語（中文 ⇄ 日本語）— 画面のみ。帳票は常に日本語。
     --------------------------------------------------------- */

  var I18N = {
    brandName:    { zh: '医療証明書類 作成ツール', ja: '医療証明書類 作成ツール' },
    tagline:      { zh: '免费・无需注册・浏览器内完成', ja: '無料・登録不要・ブラウザだけで完結' },
    btnPrint:     { zh: '打印 / 保存 PDF', ja: '印刷 / PDF保存' },
    btnReset:     { zh: '清空重填', ja: 'リセット' },
    btnSample:    { zh: '一键填入示例', ja: '記入例を入れる' },
    btnLang:      { zh: '日本語', ja: '中文' },

    legendSeal:   { zh: '印章（判子・医療機関印）', ja: '印章（判子・医療機関印）' },
    badgeSeal:    { zh: '見本', ja: '見本' },
    chkSeal:      { zh: '加盖印章（按医疗机构名・医师名生成朱色圆章）', ja: '印章を付ける（医療機関名・医師名から朱色の丸印を生成）' },
    helpSeal:     { zh: '开启后，三张凭证的盖章位会显示根据医疗机构名与医师名生成的朱色圆章（下書き用の見本）。关闭后仍保留空白盖章位，便于手工盖章。',
                    ja: 'オンにすると、3通の押印欄に医療機関名・医師名から生成した朱色の丸印（下書き用の見本）を表示します。オフにすると白紙の押印欄のまま残るので、手で押印できます。' },

    formTitle:    { zh: '输入一次就诊信息，生成一套凭证', ja: '1回の入力で、3通の書類を作成' },
    formHint:     { zh: '左侧填写，右侧实时预览三张日文凭证。最后点「打印 / 保存 PDF」合并输出为一份 A4 PDF。',
                    ja: '左側に入力すると、右側のプレビューにすぐ反映されます。最後に「印刷 / PDF保存」で3通をまとめて出力できます。' },

    legalTitle:   { zh: '本工具为格式参考・下書き模板', ja: '本ツールは形式確認・下書き用テンプレートです' },
    legalZh:      { zh: '本工具为就诊凭证的格式参考与下書き模板。正式的領収書・診療明細書由医疗机构开具，正式診断書必须由医师作成・署名・押印。本工具生成的文书不能作为正式凭证提交。',
                    ja: '本ツールは診療に関する書類の形式確認・下書き用テンプレートです。正式な領収書・診療明細書は医療機関が発行し、正式な診断書は必ず医師が作成・署名・押印したものをご使用ください。本ツールが生成した文書を正式な証明書類として提出することはできません。' },

    legendCommon: { zh: '基本信息（三张凭证共用）', ja: '基本情報（3通で共通）' },
    badgeOnce:    { zh: '填一次即可', ja: '1回の入力でOK' },
    legendReceipt:     { zh: '① 領収書（收据）', ja: '① 領収書' },
    legendStatement:   { zh: '② 診療明細書（费用明细）', ja: '② 診療明細書' },
    legendCertificate: { zh: '③ 診断書（诊断书・見本）', ja: '③ 診断書（見本）' },
    badgeAuto:    { zh: '自动汇总', ja: '自動集計' },
    badgeSample:  { zh: '带見本水印', ja: '見本の透かし入り' },

    lblInstName:  { zh: '医疗机构名称', ja: '医療機関名' },
    lblInstAddress: { zh: '所在地（地址）', ja: '所在地' },
    lblInstTel:   { zh: '电话号码', ja: '電話番号' },
    lblDoctor:    { zh: '医师姓名', ja: '医師名' },
    lblPatient:   { zh: '患者姓名', ja: '患者氏名' },
    lblKana:      { zh: 'フリガナ（假名）', ja: 'フリガナ' },
    lblSex:       { zh: '性别', ja: '性別' },
    lblBirth:     { zh: '出生日期', ja: '生年月日' },
    lblAge:       { zh: '年龄（自动计算）', ja: '年齢（自動計算）' },
    lblVisitDate: { zh: '就诊日期', ja: '診察日' },
    lblIssueDate: { zh: '发行日期', ja: '発行日' },
    lblDept:      { zh: '诊疗科', ja: '診療科' },
    lblDisease:   { zh: '傷病名（病名）', ja: '傷病名' },

    chkLink:      { zh: '领收金额与明细的自付额联动', ja: '領収金額を明細の自己負担額と連動する' },
    lblReceiptAmount: { zh: '領収金額（自己负担额）', ja: '領収金額（自己負担額）' },
    helpReceiptAmount: { zh: '输入金额即可。勾选上方联动时，此处自动采用诊疗明细的「自己負担額」。',
                         ja: '金額を入力します。上の連動にチェックを入れると、明細の自己負担額が自動で入ります。' },
    lblProviso:   { zh: '但書（用途）', ja: '但書' },
    lblReceiptNo: { zh: '領収番号', ja: '領収番号' },

    lblRows:      { zh: '明细行（项目・点数・金额）', ja: '明細行（項目・点数・金額）' },
    thItemName:   { zh: '项目名', ja: '項目名' },
    thPoints:     { zh: '保険点数', ja: '保険点数' },
    thAmount:     { zh: '金額（円）', ja: '金額（円）' },
    btnAddRow:    { zh: '添加明细行', ja: '明細行を追加' },
    helpRows:     { zh: '输入点数后，若金额为空会按 1点＝10円 自动填入。金额可自由修改。',
                    ja: '点数を入力すると、金額が空のときは 1点＝10円 で自動入力します。金額は自由に変更できます。' },
    lblBurden:    { zh: '自己负担比例', ja: '負担割合' },
    lblSelfOverride: { zh: '自己負担額（手动覆盖）', ja: '自己負担額（手動上書き）' },
    helpSelfOverride: { zh: '留空则由负担比例自动计算。填写后以此金额为准。',
                        ja: '空欄なら負担割合から自動計算します。入力するとその金額が優先されます。' },
    lblRx:        { zh: '处方药附记（可选）', ja: '処方薬（任意）' },
    thDrug:       { zh: '薬品名', ja: '薬品名' },
    thUsage:      { zh: '用法・用量', ja: '用法・用量' },
    thDays:       { zh: '日数', ja: '日数' },
    btnAddRx:     { zh: '添加处方药', ja: '処方薬を追加' },
    btnDelete:    { zh: '删除', ja: '削除' },

    lblFindings:  { zh: '診断内容・所見', ja: '診断内容・所見' },
    lblPeriodFrom: { zh: '疗养期间（自）', ja: '療養期間（自）' },
    lblPeriodTo:  { zh: '疗养期间（至）', ja: '療養期間（至）' },
    lblOutcome:   { zh: '転帰（转归）', ja: '転帰' },
    noteDoctorSeal: { zh: '正式な診断書は、医師の署名と医療機関の印が必要です。本ツールが押印欄に表示する印は下書き用の「見本」で、正式な印ではありません。',
                      ja: '正式な診断書は、医師の署名と医療機関の印が必要です。本ツールが押印欄に表示する印は下書き用の「見本」で、正式な印ではありません。' },
    privacy:      { zh: '输入内容不会发送到服务器，全部只在你的浏览器内处理。关闭页面后内容即被丢弃。',
                    ja: '入力した内容はサーバーに送信されません。すべてお使いのブラウザ内だけで処理されます。' },

    phInst:       { zh: '例：佐藤内科クリニック', ja: '例：佐藤内科クリニック' },
    phDoctor:     { zh: '例：佐藤 一郎', ja: '例：佐藤 一郎' },
    phPatient:    { zh: '例：田中 健太', ja: '例：田中 健太' },
    phKana:       { zh: '例：タナカ ケンタ', ja: '例：タナカ ケンタ' },
    phDept:       { zh: '例：内科', ja: '例：内科' },
    phDisease:    { zh: '例：高血圧症', ja: '例：高血圧症' },
    phFindings:   { zh: '例：血圧 158/96mmHg。自覚症状は軽度の頭痛。', ja: '例：血圧 158/96mmHg。自覚症状は軽度の頭痛。' },
    phItemName:   { zh: '例：初診料', ja: '例：初診料' },
    phDrug:       { zh: '例：アムロジピン錠5mg', ja: '例：アムロジピン錠5mg' },
    phUsage:      { zh: '例：1日1回 朝食後', ja: '例：1日1回 朝食後' },

    previewBar:   { zh: '预览（A4・三张凭证）', ja: 'プレビュー（A4・3通）' },
    footerText:   { zh: '医療証明書類 作成ツール — 領収書・診療明細書・診断書（見本）をまとめて作る無料ツール',
                    ja: '医療証明書類 作成ツール — 領収書・診療明細書・診断書（見本）をまとめて作る無料ツール' }
  };

  var lang = 'zh';

  function applyI18n(next) {
    lang = next;
    document.documentElement.lang = (lang === 'zh') ? 'zh-CN' : 'ja';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var entry = I18N[key];
      if (entry && entry[lang]) el.textContent = entry[lang];
    });

    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-ph');
      var entry = I18N[key];
      if (entry && entry[lang]) el.setAttribute('placeholder', entry[lang]);
    });

    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      var entry = I18N[key];
      if (entry && entry[lang]) el.setAttribute('aria-label', entry[lang]);
    });

    var langBtn = $('langBtn');
    if (langBtn) langBtn.textContent = I18N.btnLang[lang];

    // 日本語の詳細免責は、中国語モードのときだけ併記する
    document.querySelectorAll('.legal-ja').forEach(function (el) {
      el.hidden = (lang === 'ja');
    });
  }

  /* ---------------------------------------------------------
     初期データ（初回表示のサンプル）
     --------------------------------------------------------- */

  var DEFAULTS = {
    instName: '佐藤内科クリニック',
    instAddress: '〒150-0002 東京都渋谷区渋谷1-2-3 サンプルビル2F',
    instTel: '03-1234-5678',
    doctorName: '佐藤 一郎',
    patientName: '田中 健太',
    patientKana: 'タナカ ケンタ',
    sex: '男性',
    birthDate: '1985-04-12',
    visitDate: '2026-10-05',
    department: '内科',
    diseaseName: '高血圧症',
    linkReceipt: true,
    receiptAmount: 1827,
    proviso: '診療費として',
    receiptNo: 'RY-2026-0001',
    burdenRate: '30',
    selfPayOverride: '',
    detailRows: [
      { name: '初診料', points: 291, amount: 2910 },
      { name: '血液検査', points: 250, amount: 2500 },
      { name: '処方箋料', points: 68, amount: 680 }
    ],
    rxRows: [
      { drug: 'アムロジピン錠5mg', usage: '1日1回 朝食後', days: 30 }
    ],
    findings: '血圧 158/96mmHg。自覚症状は軽度の頭痛。\n生活習慣の改善と内服治療が必要と判断した。',
    periodFrom: '2026-10-05',
    periodTo: '2026-10-19',
    outcome: '軽快'
  };

  /* ---------------------------------------------------------
     行の生成・取得
     --------------------------------------------------------- */

  function addDetailRow(data) {
    var tpl = $('detailRowTpl');
    var node = tpl.content.firstElementChild.cloneNode(true);
    if (data) {
      node.querySelector('.row-name').value = data.name || '';
      node.querySelector('.row-points').value = (data.points || data.points === 0) ? comma(data.points) : '';
      node.querySelector('.row-amount').value = (data.amount || data.amount === 0) ? comma(data.amount) : '';
    }
    $('detailRows').appendChild(node);
    applyI18n(lang);
    return node;
  }

  function addRxRow(data) {
    var tpl = $('rxRowTpl');
    var node = tpl.content.firstElementChild.cloneNode(true);
    if (data) {
      node.querySelector('.row-drug').value = data.drug || '';
      node.querySelector('.row-usage').value = data.usage || '';
      node.querySelector('.row-days').value = (data.days || data.days === 0) ? comma(data.days) : '';
    }
    $('rxRows').appendChild(node);
    applyI18n(lang);
    return node;
  }

  function eachRow(containerSel, rowSel, fn) {
    document.querySelectorAll(containerSel + ' ' + rowSel).forEach(function (row) {
      if (row.classList.contains('row-head')) return;
      fn(row);
    });
  }

  function getDetailRows() {
    var out = [];
    eachRow('#detailRows', '.detail-row', function (row) {
      out.push({
        name: row.querySelector('.row-name').value.trim(),
        points: toAmount(row.querySelector('.row-points').value),
        amount: toAmount(row.querySelector('.row-amount').value)
      });
    });
    return out;
  }

  function getRxRows() {
    var out = [];
    eachRow('#rxRows', '.rx-row', function (row) {
      var drug = row.querySelector('.row-drug').value.trim();
      var usage = row.querySelector('.row-usage').value.trim();
      var days = row.querySelector('.row-days').value.trim();
      if (!drug && !usage && !days) return;
      out.push({ drug: drug, usage: usage, days: days });
    });
    return out;
  }

  /* ---------------------------------------------------------
     集計
     --------------------------------------------------------- */

  function getSummary() {
    var rows = getDetailRows();
    var totalPoints = 0;
    var totalCost = 0;
    rows.forEach(function (r) {
      totalPoints += r.points;
      totalCost += r.amount;
    });

    var rate = Number($('burdenRate').value) || 30;
    var autoSelf = Math.floor(totalCost * rate / 100);

    var overrideRaw = $('selfPayOverride').value.trim();
    var hasOverride = overrideRaw !== '';
    var selfPay = hasOverride ? toAmount(overrideRaw) : autoSelf;
    var covered = totalCost - selfPay;

    return {
      totalPoints: totalPoints,
      totalCost: totalCost,
      rate: rate,
      autoSelf: autoSelf,
      selfPay: selfPay,
      covered: covered,
      hasOverride: hasOverride
    };
  }

  function getPatient() {
    var birth = $('birthDate').value;
    var ref = $('visitDate').value || $('issueDate').value || todayISO();
    return {
      name: $('patientName').value.trim(),
      kana: $('patientKana').value.trim(),
      sex: $('sex').value,
      birth: birth,
      age: computeAge(birth, ref)
    };
  }

  function birthLine(p) {
    if (!p.birth) return '';
    var agePart = (p.age === null) ? '' : '（' + p.age + '歳）';
    return formatDate(p.birth) + agePart;
  }

  /* ---------------------------------------------------------
     プレビュー：① 領収書
     --------------------------------------------------------- */

  function renderReceipt(summary) {
    var instName = $('instName').value.trim();
    var instAddress = $('instAddress').value.trim();
    var instTel = $('instTel').value.trim();
    var doctor = $('doctorName').value.trim();

    setVal($('pvInstName'), instName, '医療機関名を入力');
    $('pvInstAddress').textContent = instAddress;
    $('pvInstAddress').hidden = !instAddress;
    $('pvInstTel').textContent = instTel ? ('TEL：' + instTel) : '';
    $('pvInstTel').hidden = !instTel;

    setVal($('pvReceiptNo'), $('receiptNo').value.trim(), '未採番');
    setVal($('pvReceiptIssueDate'), formatDate($('issueDate').value), '未入力');
    setVal($('pvReceiptPatient'), $('patientName').value.trim(), '患者氏名を入力');

    var amount = $('linkReceipt').checked ? summary.selfPay : toAmount($('receiptAmount').value);
    $('pvReceiptAmount').textContent = '金 ' + kanjiNumber(amount) + '円 也';

    // 但書が空なら行ごと省略する
    var proviso = $('proviso').value.trim();
    setVal($('pvProviso'), proviso, '但書を入力');
    $('pvProvisoLine').hidden = !proviso;

    var dept = $('department').value.trim();
    var visit = $('visitDate').value;
    var disease = $('diseaseName').value.trim();

    setVal($('pvReceiptDept'), dept, '—');
    setVal($('pvReceiptVisitDate'), formatDate(visit), '—');
    $('pvReceiptMetaRow').hidden = !dept && !visit;
    setVal($('pvReceiptDisease'), disease, '—');
    $('pvReceiptDiseaseRow').hidden = !disease;

    setVal($('pvReceiptInst'), instName, '医療機関名を入力');
    $('pvReceiptAddress').textContent = instAddress;
    $('pvReceiptAddress').hidden = !instAddress;
    $('pvReceiptTel').textContent = instTel ? ('TEL：' + instTel) : '';
    $('pvReceiptTel').hidden = !instTel;
    setVal($('pvReceiptDoctor'), doctor ? ('医師：' + doctor) : '', '医師名を入力');
  }

  /* ---------------------------------------------------------
     プレビュー：② 診療明細書
     --------------------------------------------------------- */

  function renderStatement(summary) {
    var p = getPatient();
    var instName = $('instName').value.trim();
    var instAddress = $('instAddress').value.trim();
    var instTel = $('instTel').value.trim();

    setVal($('pvStmtInstName'), instName, '医療機関名を入力');
    $('pvStmtInstAddress').textContent = instAddress;
    $('pvStmtInstAddress').hidden = !instAddress;
    $('pvStmtInstTel').textContent = instTel ? ('TEL：' + instTel) : '';
    $('pvStmtInstTel').hidden = !instTel;

    setVal($('pvStmtNo'), $('receiptNo').value.trim(), '未採番');
    setVal($('pvStmtIssueDate'), formatDate($('issueDate').value), '未入力');

    setVal($('pvStmtPatient'), p.name, '患者氏名を入力');
    setVal($('pvStmtKana'), p.kana, '—');
    $('pvStmtSex').textContent = p.sex || '—';
    setVal($('pvStmtBirth'), birthLine(p), '—');
    setVal($('pvStmtVisitDate'), formatDate($('visitDate').value), '—');
    setVal($('pvStmtDept'), $('department').value.trim(), '—');
    setVal($('pvStmtDisease'), $('diseaseName').value.trim(), '—');
    $('pvStmtDiseaseRow').hidden = !$('diseaseName').value.trim();

    /* --- 明細行 --- */
    var tbody = $('pvDetailRows');
    tbody.innerHTML = '';
    var rows = getDetailRows().filter(function (r) {
      return r.name || r.points || r.amount;
    });

    if (rows.length === 0) {
      var trEmpty = document.createElement('tr');
      trEmpty.innerHTML = '<td colspan="3" class="ph">明細行がありません</td>';
      tbody.appendChild(trEmpty);
    } else {
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(r.name || '—') + '</td>' +
          '<td class="num">' + (r.points ? comma(r.points) : '—') + '</td>' +
          '<td class="num">' + (r.amount ? comma(r.amount) : '—') + '</td>';
        tbody.appendChild(tr);
      });
    }

    /* --- 集計 --- */
    $('pvTotalPoints').textContent = comma(summary.totalPoints);
    $('pvTotalCost').textContent = comma(summary.totalCost);
    // rate は百分率（30 = 3割）。表示は「割」に直す。
    $('pvCoveredRate').textContent = String((100 - summary.rate) / 10);
    $('pvCovered').textContent = comma(summary.covered);
    $('pvSelfRate').textContent = String(summary.rate / 10);
    $('pvSelfPay').textContent = comma(summary.selfPay);
    $('pvStmtSelfPay').textContent = yen(summary.selfPay);

    /* --- 処方薬 --- */
    var rxRows = getRxRows();
    var rxBlock = $('pvRxBlock');
    var rxBody = $('pvRxRows');
    rxBody.innerHTML = '';
    rxBlock.hidden = rxRows.length === 0;
    rxRows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(r.drug || '—') + '</td>' +
        '<td>' + escapeHtml(r.usage || '—') + '</td>' +
        '<td class="num">' + (r.days ? escapeHtml(r.days) + ' 日' : '—') + '</td>';
      rxBody.appendChild(tr);
    });
  }

  /* ---------------------------------------------------------
     プレビュー：③ 診断書
     --------------------------------------------------------- */

  function renderCertificate() {
    var p = getPatient();
    var instName = $('instName').value.trim();
    var instAddress = $('instAddress').value.trim();
    var instTel = $('instTel').value.trim();
    var doctor = $('doctorName').value.trim();
    var issue = formatDate($('issueDate').value);

    setVal($('pvCertInstName'), instName, '医療機関名を入力');
    $('pvCertInstAddress').textContent = instAddress;
    $('pvCertInstAddress').hidden = !instAddress;
    $('pvCertInstTel').textContent = instTel ? ('TEL：' + instTel) : '';
    $('pvCertInstTel').hidden = !instTel;

    $('pvCertIssueDate').textContent = issue;
    $('pvCertIssueDateFoot').textContent = issue;

    setVal($('pvCertPatient'), p.name, '患者氏名を入力');
    setVal($('pvCertKana'), p.kana, '—');
    $('pvCertSex').textContent = p.sex || '—';
    setVal($('pvCertBirth'), birthLine(p), '—');
    setVal($('pvCertDept'), $('department').value.trim(), '—');
    setVal($('pvCertVisitDate'), formatDate($('visitDate').value), '—');

    setVal($('pvCertDisease'), $('diseaseName').value.trim(), '傷病名を入力');

    // 所見が未入力ならエラーにせず、記入用の空白欄を確保する
    var findings = $('findings').value.trim();
    var findingsCell = $('pvCertFindings');
    if (findings) {
      findingsCell.textContent = findings;
      findingsCell.classList.remove('blank-area');
    } else {
      findingsCell.textContent = '';
      findingsCell.classList.add('blank-area');
    }

    var pf = $('periodFrom').value;
    var pt = $('periodTo').value;
    setVal($('pvCertPeriodFrom'), formatDate(pf), '—');
    setVal($('pvCertPeriodTo'), formatDate(pt), '—');
    $('pvCertPeriodRow').hidden = !pf && !pt;
    setVal($('pvCertOutcome'), $('outcome').value, '—');

    setVal($('pvCertInstFoot'), instName, '医療機関名を入力');
    setVal($('pvCertDoctor'), doctor, '医師名を入力');
  }

  /* ---------------------------------------------------------
     押印欄（印章の描画・プレースホルダ復帰）
     --------------------------------------------------------- */

  var sealHolders = null;

  function initSealHolders() {
    sealHolders = ['sealReceipt', 'sealStatement', 'sealCertInst', 'sealCertDoctor']
      .map(function (id) { return $(id); })
      .filter(Boolean);
    sealHolders.forEach(function (el) {
      el.setAttribute('data-ph-html', el.innerHTML);
    });
  }

  function renderSeals() {
    if (!sealHolders) return;
    var enabled = $('sealToggle').checked;
    var inst = $('instName').value.trim();
    var doctor = $('doctorName').value.trim();
    sealHolders.forEach(function (el) {
      if (enabled) {
        el.innerHTML = buildSealSVG(inst, doctor);
        el.classList.add('is-stamped');
      } else {
        el.innerHTML = el.getAttribute('data-ph-html') || '';
        el.classList.remove('is-stamped');
      }
    });
  }

  /* ---------------------------------------------------------
     連動・年齢
     --------------------------------------------------------- */

  function syncReceiptLink(summary) {
    var linked = $('linkReceipt').checked;
    var input = $('receiptAmount');
    input.disabled = linked;
    if (linked) {
      input.value = comma(summary.selfPay);
    }
  }

  function updateAge() {
    var p = getPatient();
    $('ageOut').value = (p.age === null) ? '' : (p.age + ' 歳');
  }

  /* ---------------------------------------------------------
     まとめ描画
     --------------------------------------------------------- */

  function refresh() {
    syncAutoNumber();
    var summary = getSummary();
    syncReceiptLink(summary);
    renderReceipt(summary);
    renderStatement(summary);
    renderCertificate();
    renderSeals();
    updateAge();
  }

  /* ---------------------------------------------------------
     フォーム初期化・リセット
     --------------------------------------------------------- */

  function clearRows() {
    eachRow('#detailRows', '.detail-row', function (row) { row.remove(); });
    eachRow('#rxRows', '.rx-row', function (row) { row.remove(); });
  }

  var receiptNoTouched = false;

  // 発行日から領収番号を自動採番（例：RY-20261011-01）
  function autoNumber() {
    var iso = $('issueDate').value || todayISO();
    return 'RY-' + String(iso).replace(/-/g, '') + '-01';
  }

  function syncAutoNumber() {
    if (receiptNoTouched) return;
    var next = autoNumber();
    if ($('receiptNo').value !== next) $('receiptNo').value = next;
  }

  function clearFieldValues() {
    ['instName', 'instAddress', 'instTel', 'doctorName', 'patientName', 'patientKana',
      'birthDate', 'department', 'diseaseName', 'receiptAmount', 'selfPayOverride',
      'findings', 'periodFrom', 'periodTo', 'proviso', 'receiptNo'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });
  }

  // 初回・リセット時：日付は今日、番号は自動採番、但書・負担割合は既定値
  function applySmartDefaults() {
    clearFieldValues();

    $('sex').value = '男性';
    $('burdenRate').value = '30';
    $('outcome').value = '軽快';

    var today = todayISO();
    $('visitDate').value = today;
    $('issueDate').value = today;

    $('proviso').value = '診療費として';
    $('linkReceipt').checked = true;
    $('sealToggle').checked = true;

    receiptNoTouched = false;
    $('receiptNo').value = autoNumber();

    clearRows();
    addDetailRow(null);
  }

  // 「記入例を入れる」：サンプルデータ一式を流し込む
  function applySampleData() {
    clearFieldValues();

    $('instName').value = DEFAULTS.instName;
    $('instAddress').value = DEFAULTS.instAddress;
    $('instTel').value = DEFAULTS.instTel;
    $('doctorName').value = DEFAULTS.doctorName;
    $('patientName').value = DEFAULTS.patientName;
    $('patientKana').value = DEFAULTS.patientKana;
    $('sex').value = DEFAULTS.sex;
    $('birthDate').value = DEFAULTS.birthDate;
    $('department').value = DEFAULTS.department;
    $('diseaseName').value = DEFAULTS.diseaseName;

    $('linkReceipt').checked = true;
    $('proviso').value = DEFAULTS.proviso;
    $('burdenRate').value = DEFAULTS.burdenRate;
    $('selfPayOverride').value = '';

    $('findings').value = DEFAULTS.findings;
    $('outcome').value = DEFAULTS.outcome;

    $('issueDate').value = todayISO();
    $('visitDate').value = shiftISO(-6);
    $('periodFrom').value = shiftISO(-6);
    $('periodTo').value = shiftISO(8);

    $('sealToggle').checked = true;
    receiptNoTouched = false;
    $('receiptNo').value = autoNumber();

    clearRows();
    DEFAULTS.detailRows.forEach(addDetailRow);
    DEFAULTS.rxRows.forEach(addRxRow);
  }

  function resetForm() {
    applySmartDefaults();
    applyI18n(lang);
    refresh();
  }

  function sampleForm() {
    applySampleData();
    applyI18n(lang);
    refresh();
  }

  /* ---------------------------------------------------------
     数値フィールドの整形
     --------------------------------------------------------- */

  function formatNumField(input) {
    var value = toAmount(input.value);
    input.value = value ? comma(value) : '';
  }

  /* ---------------------------------------------------------
     初期化
     --------------------------------------------------------- */

  function init() {
    initSealHolders();
    applySmartDefaults();
    applyI18n(lang);

    var form = $('iryoForm');

    // 明細行の点数入力 → 金額が空なら 1点=10円 で自動入力
    $('detailRows').addEventListener('input', function (event) {
      var target = event.target;
      if (!target.classList.contains('row-points')) return;
      var row = target.closest('.detail-row');
      if (!row) return;
      var amountInput = row.querySelector('.row-amount');
      if (amountInput && amountInput.value.trim() === '') {
        var pts = toAmount(target.value);
        amountInput.value = pts ? comma(pts * 10) : '';
      }
    });

    // 行の削除
    function onRowClick(event) {
      var del = event.target.closest('.row-del');
      if (!del) return;
      var row = del.closest('.detail-row, .rx-row');
      if (row) row.remove();
      refresh();
    }
    $('detailRows').addEventListener('click', onRowClick);
    $('rxRows').addEventListener('click', onRowClick);

    // 行の追加
    $('addRowBtn').addEventListener('click', function () {
      var row = addDetailRow(null);
      refresh();
      var nameInput = row.querySelector('.row-name');
      if (nameInput) nameInput.focus();
    });
    $('addRxBtn').addEventListener('click', function () {
      var row = addRxRow(null);
      refresh();
      var drugInput = row.querySelector('.row-drug');
      if (drugInput) drugInput.focus();
    });

    // 数値欄はフォーカスが外れたときにカンマ区切りへ整形
    document.addEventListener('focusout', function (event) {
      var t = event.target;
      if (!t || !t.classList) return;
      if (t.id === 'receiptAmount' || t.id === 'selfPayOverride' ||
          t.classList.contains('row-points') || t.classList.contains('row-amount') ||
          t.classList.contains('row-days')) {
        formatNumField(t);
      }
    });

    form.addEventListener('input', function (event) {
      // 領収番号を手で編集したら、以降は自動採番で上書きしない
      if (event.target && event.target.id === 'receiptNo') receiptNoTouched = true;
      refresh();
    });
    form.addEventListener('change', refresh);

    $('printBtn').addEventListener('click', function () {
      window.print();
    });
    $('resetBtn').addEventListener('click', resetForm);
    $('sampleBtn').addEventListener('click', sampleForm);

    $('langBtn').addEventListener('click', function () {
      applyI18n(lang === 'zh' ? 'ja' : 'zh');
    });

    refresh();
  }

  /* ---------------------------------------------------------
     テスト用フック（純粋関数の検証用）
     --------------------------------------------------------- */

  window.__iryo = {
    kanjiNumber: kanjiNumber,
    comma: comma,
    yen: yen,
    toAmount: toAmount,
    computeAge: computeAge,
    getSummary: getSummary,
    getPatient: getPatient,
    refresh: refresh,
    buildSealSVG: buildSealSVG,
    resetForm: resetForm,
    sampleForm: sampleForm,
    autoNumber: autoNumber,
    getLang: function () { return lang; },
    setLang: function (l) { applyI18n(l); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
