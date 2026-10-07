// Registro único de Chart.js. Importar este módulo en cualquier componente que dibuje.
//
// Chart.js es modular: lo que no se registra, no existe. Registrarlo en un solo sitio evita
// el clásico "controller 'doughnut' is not registered" al añadir una gráfica nueva.
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  TimeScale,
  Title,
  Tooltip,
} from 'chart.js';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  TimeScale,
  Title,
  Tooltip,
  annotationPlugin,
  zoomPlugin,
);

// Tipografía coherente con el resto de la interfaz.
Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
Chart.defaults.font.size = 12;
// Las animaciones por defecto pelean con las actualizaciones a 5 Hz del tiempo real.
Chart.defaults.animation = false;
Chart.defaults.maintainAspectRatio = false;

export { Chart };
