import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/firebase_service.dart';

class DashboardScreen extends StatelessWidget {
  final FirebaseService firebaseService;

  const DashboardScreen({Key? key, required this.firebaseService}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('StockFlow ERP Dashboard', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      backgroundColor: const Color(0xFF0F172A),
      body: StreamBuilder<List<StockModel>>(
        stream: firebaseService.getStocksStream(),
        builder: (context, stockSnap) {
          if (stockSnap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: Colors.indigoAccent));
          }

          final stocks = stockSnap.data ?? [];
          final totalAvailable = stocks.fold<int>(0, (sum, s) => sum + s.availableQty);
          final totalInTransit = stocks.fold<int>(0, (sum, s) => sum + s.inTransitQty);
          final totalDamaged = stocks.fold<int>(0, (sum, s) => sum + s.damagedQty);
          final lowStockCount = stocks.where((s) => s.availableQty <= 15).length;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Live Inventory Overview',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                ),
                const SizedBox(height: 12),
                GridView.count(
                  crossAxisCount: MediaQuery.of(context).size.width > 600 ? 4 : 2,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    _buildKpiCard('Total Available', totalAvailable.toString(), Colors.emerald, Icons.inventory_2),
                    _buildKpiCard('In-Transit Stock', totalInTransit.toString(), Colors.indigoAccent, Icons.local_shipping),
                    _buildKpiCard('Damaged / Scrapped', totalDamaged.toString(), Colors.roseAccent, Icons.dangerous),
                    _buildKpiCard('Low Stock Alerts', lowStockCount.toString(), Colors.amberAccent, Icons.warning_amber),
                  ],
                ),
                const SizedBox(height: 24),
                const Text(
                  'Warehouse Stock Balances',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                ),
                const SizedBox(height: 12),
                ListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: stocks.length,
                  itemBuilder: (context, index) {
                    final item = stocks[index];
                    return Card(
                      color: const Color(0xFF1E293B),
                      margin: const EdgeInsets.only(bottom: 8),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: Colors.indigo.withOpacity(0.2),
                          child: const Icon(Icons.build_circle, color: Colors.indigoAccent),
                        ),
                        title: Text(item.itemName.isNotEmpty ? item.itemName : item.itemCode,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                        subtitle: Text('${item.warehouseName} (${item.warehouseId})',
                            style: const TextStyle(color: Colors.white60, fontSize: 12)),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text('${item.availableQty} Pcs',
                                style: const TextStyle(color: Colors.emeraldAccent, fontWeight: FontWeight.bold, fontSize: 14)),
                            if (item.inTransitQty > 0)
                              Text('+${item.inTransitQty} transit',
                                  style: const TextStyle(color: Colors.indigoAccent, fontSize: 10)),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildKpiCard(String title, String value, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: color, size: 28),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color)),
              Text(title, style: const TextStyle(fontSize: 12, color: Colors.white70)),
            ],
          )
        ],
      ),
    );
  }
}
