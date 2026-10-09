(function () {
  const SINK_PATTERNS = {
    'HTML Execution': [
      /\.innerHTML/, /\.outerHTML/, /\.insertAdjacentHTML\s*\(/,
      /document\.write(ln)?\s*\(/, /\.srcdoc/, /DOMParser\s*\(/,
      /\.parseFromString\s*\(/, /createContextualFragment\s*\(/,
      /setHTMLUnsafe\s*\(/, /parseHTMLUnsafe\s*\(/
    ],
    'JS Execution': [
      /\beval\s*\(/, /setTimeout\s*\(\s*["'`]/, /setInterval\s*\(\s*["'`]/,
      /setImmediate\s*\(/, /execScript\s*\(/,
      /script\.src\s*=/, /script\.text\s*=/, /script\.textContent\s*=/,
      /script\.innerText\s*=/, /\bimport\s*\(/, /new\s+Worker\s*\(/,
      /importScripts\s*\(/
    ],
    'Navigation / URL': [
      /\blocation\s*=/, /location\.href\s*=/, /location\.assign\s*\(/,
      /location\.replace\s*\(/, /location\.search\s*=/, /location\.hash\s*=/,
      /window\.open\s*\(/, /a\.href\s*=/, /form\.action\s*=/, /formaction\s*=/,
      /iframe\.src\s*=/, /embed\.src\s*=/, /object\.data\s*=/,
      /link\.href\s*=/, /base\.href\s*=/, /http-equiv\s*=\s*["']refresh["']/,
      /document\.domain\s*=/
    ],
    'Attribute': [
      /\.setAttribute\s*\(/, /\.setAttributeNS\s*\(/, /\.attributes\[/,
      /\bon(click|error|load|mouseover|focus|input|change)\s*=/,
      /\.style\.cssText\s*=/
    ],
    'jQuery': [
      /\$\s*\(/, /jQuery\s*\(/, /\.html\s*\(/,
      /\.append\s*\(/, /\.prepend\s*\(/, /\.after\s*\(/, /\.before\s*\(/,
      /\.replaceWith\s*\(/, /\.wrap(All|Inner)?\s*\(/, /\.add\s*\(/,
      /\.attr\s*\(/, /\.prop\s*\(/, /\.load\s*\(/,
      /\$\.parseHTML/, /\$\.globalEval/, /\$\.getScript/, /\$\.ajax/,
      /:contains\s*\(/
    ],
    'Framework': [
      /dangerouslySetInnerHTML/, /v-html/, /\{@html/, /\[innerHTML\]/,
      /bypassSecurityTrust(Html|Script|Url|ResourceUrl|Style)/,
      /ng-bind-html/, /\$sce\.trustAs/, /\$compile\s*\(/,
      /\$eval\s*\(/, /\$watch\s*\(/, /\{\{.*\}\}/
    ],
    'Network / Storage': [
      /postMessage\s*\(/, /addEventListener\s*\(\s*["']message["']/,
      /XMLHttpRequest\s*\(\s*\)\.open/, /fetch\s*\(/, /new\s+WebSocket\s*\(/,
      /navigator\.sendBeacon/, /history\.pushState\s*\(/,
      /history\.replaceState\s*\(/, /document\.cookie\s*=/,
      /localStorage\.setItem/, /sessionStorage\.setItem/
    ],
    'Prototype Pollution': [
      /Object\.assign\s*\(/, /\b(merge|extend|deepMerge|defaultsDeep)\s*\(/,
      /__proto__/, /\.constructor\.prototype/, /JSON\.parse\s*\(/
    ]
  };

  function scanText(text, sourceName, patterns, findings, seen) {
    for (const [category, list] of Object.entries(patterns)) {
      for (const re of list) {
        const regex = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let m;
        while ((m = regex.exec(text)) !== null) {
          const start = Math.max(0, m.index - 40);
          const end = Math.min(text.length, m.index + m[0].length + 40);
          const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
          const key = category + '|' + m[0] + '|' + sourceName;
          if (seen.has(key)) continue;
          seen.add(key);
          (findings[category] = findings[category] || []).push({
            match: m[0], snippet, source: sourceName
          });
          if (regex.lastIndex === m.index) regex.lastIndex++;
        }
      }
    }
  }

  window.sinkScan = async function (categories = null) {
    let filtered = SINK_PATTERNS;
    if (categories) {
      const list = Array.isArray(categories) ? categories : [categories];
      filtered = {};
      for (const cat of list) {
        if (!SINK_PATTERNS[cat]) {
          console.warn('Unknown category:', cat, '| Valid:', Object.keys(SINK_PATTERNS));
          continue;
        }
        filtered[cat] = SINK_PATTERNS[cat];
      }
      if (Object.keys(filtered).length === 0) return;
    }

    const findings = {};
    const seen = new Set();

    scanText(document.documentElement.outerHTML, 'HTML', filtered, findings, seen);

    document.querySelectorAll('script:not([src])').forEach((el, i) => {
      scanText(el.textContent || '', 'inline-script-' + i, filtered, findings, seen);
    });

    const externalScripts = [...document.querySelectorAll('script[src]')]
      .map(s => s.src)
      .filter((v, i, a) => a.indexOf(v) === i);

    await Promise.all(externalScripts.map(async (src) => {
      try {
        const res = await fetch(src);
        if (!res.ok) return;
        const text = await res.text();
        scanText(text, src, filtered, findings, seen);
      } catch (e) {
        // CORS یا خطای شبکه - نادیده گرفته میشه
      }
    }));

    window.__sinkFindings = findings;

    console.log(`%cSink Scan Results${categories ? ' (categories: ' + (Array.isArray(categories) ? categories.join(', ') : categories) + ')' : ''}`, 'font-weight:bold;font-size:14px');
    for (const [cat, items] of Object.entries(findings)) {
      console.groupCollapsed(`${cat} (${items.length})`);
      console.table(items);
      console.groupEnd();
    }
    if (Object.keys(findings).length === 0) console.log('No sinks found.');

    console.log('%cFor copy: copy(window.__sinkFindings)  |  For download: downloadFindings()', 'color:gray;font-style:italic');

    return findings;
  };

  window.downloadFindings = function (filename) {
    if (!window.__sinkFindings || Object.keys(window.__sinkFindings).length === 0) {
      console.warn('No findings yet. Run sinkScan() first.');
      return;
    }
    const json = JSON.stringify(window.__sinkFindings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `sink-scan-${location.hostname}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log('Downloaded:', a.download);
  };
})();
