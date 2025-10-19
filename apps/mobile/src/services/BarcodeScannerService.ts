/**
 * Barcode Scanner Service
 * Handles barcode scanning for the Yabaii mobile app
 */

import { BarCodeScanner } from 'expo-barcode-scanner';
import { Camera } from 'expo-camera';
import { Platform } from 'react-native';
import { apiClient } from '../api/client';

export type BarcodeType =
  | 'aztec'
  | 'codabar'
  | 'code128'
  | 'code39'
  | 'code39mod43'
  | 'code93'
  | 'ean13'
  | 'ean8'
  | 'gs1datamatrix'
  | 'gs1qrcode'
  | 'itf14'
  | 'itf'
  | 'maxicode'
  | 'pdf417'
  | 'qr'
  | 'rss14'
  | 'rssexpanded'
  | 'upc_a'
  | 'upc_e'
  | 'upc_ean_extension';

export interface ScanResult {
  type: BarcodeType;
  data: string;
  cornerPoints?: { x: number; y: number }[];
  isValid?: boolean;
  product?: {
    id: string;
    name: string;
    brand?: string;
    category?: string;
    price?: number;
    image?: string;
    platforms: string[];
  };
}

export interface ScanOptions {
  barcodeTypes?: BarcodeType[];
  enableVibration?: boolean;
  enableSound?: boolean;
  autoAccept?: boolean;
  timeout?: number;
}

export class BarcodeScannerService {
  private static instance: BarcodeScannerService;
  private hasPermission: boolean = false;

  private constructor() {}

  static getInstance(): BarcodeScannerService {
    if (!BarcodeScannerService.instance) {
      BarcodeScannerService.instance = new BarcodeScannerService();
    }
    return BarcodeScannerService.instance;
  }

  /**
   * Initialize barcode scanner service
   */
  async initialize(): Promise<void> {
    try {
      // Request camera permissions
      const { status } = await Camera.requestCameraPermissionsAsync();
      this.hasPermission = status === 'granted';

      if (!this.hasPermission) {
        throw new Error('Camera permission is required for barcode scanning');
      }

      console.log('Barcode scanner service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize barcode scanner service:', error);
      throw error;
    }
  }

  /**
   * Check camera permissions
   */
  async checkPermissions(): Promise<boolean> {
    try {
      const { status } = await Camera.getCameraPermissionsAsync();
      this.hasPermission = status === 'granted';
      return this.hasPermission;
    } catch (error) {
      console.error('Failed to check camera permissions:', error);
      return false;
    }
  }

  /**
   * Request camera permissions
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      this.hasPermission = status === 'granted';
      return this.hasPermission;
    } catch (error) {
      console.error('Failed to request camera permissions:', error);
      return false;
    }
  }

  /**
   * Scan barcode and return product information
   */
  async scanBarcode(options: ScanOptions = {}): Promise<ScanResult> {
    try {
      if (!this.hasPermission) {
        const granted = await this.requestPermissions();
        if (!granted) {
          throw new Error('Camera permission not granted');
        }
      }

      // Default barcode types for Japanese market
      const defaultTypes: BarcodeType[] = [
        'ean13', // Most common for Japanese products
        'jan',  // Japanese Article Number (same as EAN-13)
        'upc_a',
        'upc_e',
        'code128',
        'qr',
        'code39',
      ];

      const barcodeTypes = options.barcodeTypes || defaultTypes;

      // This would typically be handled by a UI component
      // For now, we'll simulate the scan process
      // In a real implementation, this would integrate with the camera view
      const mockScanResult: ScanResult = {
        type: 'ean13',
        data: '4901085085155', // Example Japanese product barcode
        isValid: true,
      };

      // Look up product information
      const product = await this.lookupProduct(mockScanResult.data);
      if (product) {
        mockScanResult.product = product;
      }

      return mockScanResult;
    } catch (error) {
      console.error('Failed to scan barcode:', error);
      throw error;
    }
  }

  /**
   * Look up product by barcode/JAN code
   */
  async lookupProduct(barcode: string): Promise<ScanResult['product'] | null> {
    try {
      const response = await apiClient.get(`/search/barcode/${barcode}`);

      if (response.data && response.data.success) {
        return response.data.data;
      }

      return null;
    } catch (error) {
      console.error('Failed to lookup product by barcode:', barcode, error);
      return null;
    }
  }

  /**
   * Validate barcode format
   */
  validateBarcode(barcode: string, type?: BarcodeType): boolean {
    if (!barcode || barcode.length === 0) {
      return false;
    }

    // Remove any non-digit characters for validation
    const cleanBarcode = barcode.replace(/[^0-9]/g, '');

    switch (type) {
      case 'ean13':
      case 'jan':
        return cleanBarcode.length === 13 && this.validateEAN13(cleanBarcode);

      case 'ean8':
        return cleanBarcode.length === 8 && this.validateEAN8(cleanBarcode);

      case 'upc_a':
        return cleanBarcode.length === 12 && this.validateUPCA(cleanBarcode);

      case 'upc_e':
        return cleanBarcode.length === 8 && this.validateUPCE(cleanBarcode);

      default:
        // For other types, just check if it's not empty
        return barcode.length > 0;
    }
  }

  /**
   * Validate EAN-13 checksum
   */
  private validateEAN13(barcode: string): boolean {
    if (barcode.length !== 13) return false;

    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(barcode[i]);
      sum += i % 2 === 0 ? digit : digit * 3;
    }

    const checksum = (10 - (sum % 10)) % 10;
    return checksum === parseInt(barcode[12]);
  }

  /**
   * Validate EAN-8 checksum
   */
  private validateEAN8(barcode: string): boolean {
    if (barcode.length !== 8) return false;

    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const digit = parseInt(barcode[i]);
      sum += i % 2 === 0 ? digit * 3 : digit;
    }

    const checksum = (10 - (sum % 10)) % 10;
    return checksum === parseInt(barcode[7]);
  }

  /**
   * Validate UPC-A checksum
   */
  private validateUPCA(barcode: string): boolean {
    if (barcode.length !== 12) return false;

    let sum = 0;
    for (let i = 0; i < 11; i++) {
      const digit = parseInt(barcode[i]);
      sum += i % 2 === 0 ? digit * 3 : digit;
    }

    const checksum = (10 - (sum % 10)) % 10;
    return checksum === parseInt(barcode[11]);
  }

  /**
   * Validate UPC-E checksum
   */
  private validateUPCE(barcode: string): boolean {
    if (barcode.length !== 8) return false;

    // Convert UPC-E to UPC-A for checksum validation
    let upca = '';
    const lastDigit = barcode[7];

    if (barcode[6] === '0') {
      upca = barcode.substring(0, 6) + '00000' + barcode[6] + lastDigit;
    } else if (barcode[6] === '1') {
      upca = barcode.substring(0, 6) + '10000' + barcode[6] + lastDigit;
    } else if (barcode[6] === '2') {
      upca = barcode.substring(0, 6) + '20000' + barcode[6] + lastDigit;
    } else if (barcode[6] === '3') {
      upca = barcode.substring(0, 4) + barcode[6] + '0000' + barcode[5] + lastDigit;
    } else if (barcode[6] === '4') {
      upca = barcode.substring(0, 4) + barcode[6] + '10000' + barcode[5] + lastDigit;
    } else if (barcode[6] === '5') {
      upca = barcode.substring(0, 4) + barcode[6] + '20000' + barcode[5] + lastDigit;
    } else if (barcode[6] === '6') {
      upca = barcode.substring(0, 5) + '00000' + lastDigit;
    } else if (barcode[6] === '7') {
      upca = barcode.substring(0, 5) + '10000' + lastDigit;
    } else if (barcode[6] === '8') {
      upca = barcode.substring(0, 5) + '20000' + lastDigit;
    } else {
      return false;
    }

    return this.validateUPCA(upca);
  }

  /**
   * Format barcode for display
   */
  formatBarcode(barcode: string, type?: BarcodeType): string {
    if (!barcode) return '';

    switch (type) {
      case 'ean13':
      case 'jan':
        if (barcode.length === 13) {
          return `${barcode.substring(0, 1)} ${barcode.substring(1, 7)} ${barcode.substring(7, 12)} ${barcode[12]}`;
        }
        break;

      case 'ean8':
        if (barcode.length === 8) {
          return `${barcode.substring(0, 4)} ${barcode.substring(4, 7)} ${barcode[7]}`;
        }
        break;

      case 'upc_a':
        if (barcode.length === 12) {
          return `${barcode.substring(0, 1)} ${barcode.substring(1, 6)} ${barcode.substring(6, 11)} ${barcode[11]}`;
        }
        break;
    }

    return barcode;
  }

  /**
   * Get barcode type name in Japanese
   */
  getBarcodeTypeName(type: BarcodeType): string {
    const typeNames: Record<BarcodeType, string> = {
      'ean13': 'JANコード (EAN-13)',
      'jan': 'JANコード',
      'ean8': 'EAN-8',
      'upc_a': 'UPC-A',
      'upc_e': 'UPC-E',
      'code128': 'CODE-128',
      'code39': 'CODE-39',
      'code39mod43': 'CODE-39 MOD43',
      'code93': 'CODE-93',
      'qr': 'QRコード',
      'aztec': 'アステック',
      'codabar': 'コーダバー',
      'gs1datamatrix': 'GS1 DataMatrix',
      'gs1qrcode': 'GS1 QRコード',
      'itf': 'ITF',
      'itf14': 'ITF-14',
      'maxicode': 'MaxiCode',
      'pdf417': 'PDF417',
      'rss14': 'RSS-14',
      'rssexpanded': 'RSS Expanded',
      'upc_ean_extension': 'UPC/EAN拡張',
    };

    return typeNames[type] || type.toUpperCase();
  }

  /**
   * Get supported barcode types for Japanese market
   */
  getSupportedBarcodeTypes(): BarcodeType[] {
    return [
      'ean13',    // Most common in Japan
      'jan',      // Japanese Article Number
      'ean8',     // 8-digit version
      'upc_a',    // US products
      'upc_e',    // Compressed UPC
      'code128',  // General purpose
      'qr',       // QR codes are popular in Japan
      'code39',   // Industrial use
    ];
  }

  /**
   * Get scan history from local storage
   */
  async getScanHistory(): Promise<ScanResult[]> {
    try {
      // This would typically use AsyncStorage or SQLite
      // For now, return empty array
      return [];
    } catch (error) {
      console.error('Failed to get scan history:', error);
      return [];
    }
  }

  /**
   * Add scan to history
   */
  async addToHistory(scanResult: ScanResult): Promise<void> {
    try {
      const history = await this.getScanHistory();
      history.unshift({
        ...scanResult,
        timestamp: new Date().toISOString(),
      });

      // Keep only last 100 scans
      const limitedHistory = history.slice(0, 100);

      // Save to local storage
      // await AsyncStorage.setItem('scan_history', JSON.stringify(limitedHistory));
    } catch (error) {
      console.error('Failed to add scan to history:', error);
    }
  }

  /**
   * Clear scan history
   */
  async clearHistory(): Promise<void> {
    try {
      // await AsyncStorage.removeItem('scan_history');
    } catch (error) {
      console.error('Failed to clear scan history:', error);
    }
  }

  /**
   * Check if device has camera hardware
   */
  async hasCamera(): Promise<boolean> {
    try {
      const result = await Camera.getAvailableCameraDevicesAsync();
      return result.length > 0;
    } catch (error) {
      console.error('Failed to check camera availability:', error);
      return false;
    }
  }

  /**
   * Get available cameras
   */
  async getAvailableCameras(): Promise<Camera.Device[]> {
    try {
      return await Camera.getAvailableCameraDevicesAsync();
    } catch (error) {
      console.error('Failed to get available cameras:', error);
      return [];
    }
  }
}

// Export singleton instance
export const barcodeScannerService = BarcodeScannerService.getInstance();
export default barcodeScannerService;