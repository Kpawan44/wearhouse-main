import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/firebase_service.dart';

class TransfersScreen extends StatelessWidget {
  final FirebaseService firebaseService;

  const TransfersScreen({Key? key, required this.firebaseService}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Stock Transfers', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
      ),
      backgroundColor: const Color(0xFF0F172A),
      body: StreamBuilder<List<TransferModel>>(
        stream: firebaseService.getTransfersStream(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: Colors.indigoAccent));
          }

          final transfers = snapshot.data ?? [];
          if (transfers.isEmpty) {
            return const Center(
              child: Text('No transfer orders found.', style: TextStyle(color: Colors.white60)),
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: transfers.length,
            itemBuilder: (context, index) {
              final tr = transfers[index];
              Color statusColor = Colors.grey;
              if (tr.status == 'In Transit' || tr.status == 'Dispatched') {
                statusColor = Colors.amber;
              } else if (tr.status == 'Received' || tr.status == 'Closed') {
                statusColor = Colors.emerald;
              }

              return Card(
                color: const Color(0xFF1E293B),
                margin: const EdgeInsets.only(bottom: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(tr.transferNumber,
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: statusColor.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: statusColor),
                            ),
                            child: Text(tr.status, style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text('${tr.itemName} (${tr.itemCode}) - Qty: ${tr.qty} Pcs',
                          style: const TextStyle(color: Colors.white70, fontSize: 13)),
                      const SizedBox(height: 4),
                      Text('From: ${tr.sourceWarehouseName} ➔ To: ${tr.destWarehouseName}',
                          style: const TextStyle(color: Colors.white54, fontSize: 12)),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
