import { AppBar } from './components/AppBar';
import { LandingScreen } from './components/LandingScreen';
import { ResultsScreen } from './components/ResultsScreen';
import { ScanScreen } from './components/ScanScreen';
import { SetupError } from './components/SetupError';
import { TabBar } from './components/TabBar';
import { useAppController } from './hooks/useAppController';

export default function App() {
  const {
    screen,
    activeTab,
    hasMeasurement,
    scan,
    score,
    ringOffset,
    videoRef,
    faceMeshRef,
    ppgCanvasRef,
    mxCanvasRef,
    startMeasurement,
    goToSummary,
    handleTabClick,
    handleWhatsapp,
  } = useAppController();

  return (
    <div className="app">
      <AppBar />

      <main className="app__body">
        <LandingScreen active={screen === 'landing'} onStart={startMeasurement} />
        <ScanScreen
          active={screen === 'scan'}
          phase={scan.phase}
          renderMode={scan.renderMode}
          scanTimer={scan.timerLabel}
          tiles={scan.tiles}
          statusHint={scan.statusHint}
          statusValue={scan.normalized?.verdict.label ?? 'Midiendo…'}
          scoreNum={score === null ? '--' : String(score)}
          ringOffset={ringOffset}
          summaryDisabled={!hasMeasurement}
          failureReason={scan.failureReason}
          videoRef={videoRef}
          faceMeshRef={faceMeshRef}
          ppgCanvasRef={ppgCanvasRef}
          mxCanvasRef={mxCanvasRef}
          onSummary={goToSummary}
          onRetry={startMeasurement}
        />
        <ResultsScreen
          active={screen === 'results'}
          normalized={scan.normalized}
          ringOffset={ringOffset}
          isSynthetic={scan.session?.source === 'synthetic'}
          planUrl={scan.planUrl}
          onRestart={startMeasurement}
          onWhatsapp={handleWhatsapp}
        />
      </main>

      <TabBar activeTab={activeTab} onTabClick={handleTabClick} />
      <SetupError message={scan.error} onRetry={startMeasurement} />
    </div>
  );
}
