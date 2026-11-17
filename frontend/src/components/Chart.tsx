import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function Chart({
  option,
  height = 260,
}: {
  option: echarts.EChartsOption;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.setOption(option);

    // 监听容器尺寸：keep-alive 用 display:none 隐藏时 echarts.init 会拿到 0 宽，
    // 且窗口 resize 事件在 App WebView / 切 tab 恢复时不一定触发；
    // 用 ResizeObserver 持续校正画布尺寸，避免图表塌成窄条/空白。
    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(el);
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
