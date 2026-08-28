import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/models.dart';

class FirebaseService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  // Stream of Stocks
  Stream<List<StockModel>> getStocksStream() {
    return _firestore.collection('stocks').snapshots().map((snapshot) {
      return snapshot.docs.map((doc) => StockModel.fromMap(doc.id, doc.data())).toList();
    });
  }

  // Stream of Warehouses
  Stream<List<WarehouseModel>> getWarehousesStream() {
    return _firestore.collection('warehouses').snapshots().map((snapshot) {
      return snapshot.docs.map((doc) => WarehouseModel.fromMap(doc.id, doc.data())).toList();
    });
  }

  // Stream of Products
  Stream<List<ProductModel>> getProductsStream() {
    return _firestore.collection('products').snapshots().map((snapshot) {
      return snapshot.docs.map((doc) => ProductModel.fromMap(doc.id, doc.data())).toList();
    });
  }

  // Stream of Transfers
  Stream<List<TransferModel>> getTransfersStream() {
    return _firestore.collection('transfers').snapshots().map((snapshot) {
      return snapshot.docs.map((doc) => TransferModel.fromMap(doc.id, doc.data())).toList();
    });
  }

  // Fetch User Profile
  Future<UserProfile?> getUserProfile(String uid) async {
    final doc = await _firestore.collection('users').doc(uid).get();
    if (!doc.exists || doc.data() == null) return null;
    return UserProfile.fromMap(doc.id, doc.data()!);
  }
}
