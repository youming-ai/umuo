import { Hono } from 'hono';
import { authRoutes } from './auth';
import { searchRoutes } from './search';
import { productRoutes } from './products';
import { priceRoutes } from './prices';
import { alertRoutes } from './alerts';
import { dealRoutes } from './deals';
import { recommendationRoutes } from './recommendations';

export const routes = new Hono();

// Register all route modules
routes.route('/auth', authRoutes);
routes.route('/search', searchRoutes);
routes.route('/items', productRoutes);
routes.route('/prices', priceRoutes);
routes.route('/alerts', alertRoutes);
routes.route('/deals', dealRoutes);
routes.route('/recommendations', recommendationRoutes);