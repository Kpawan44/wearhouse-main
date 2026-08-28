class WarehouseModel {
  final String id;
  final String code;
  final String name;
  final String city;
  final String state;
  final String address;
  final String contactPerson;
  final String phone;
  final String status;
  final bool isPrimary;

  WarehouseModel({
    required this.id,
    required this.code,
    required this.name,
    this.city = '',
    this.state = '',
    this.address = '',
    this.contactPerson = '',
    this.phone = '',
    this.status = 'Active',
    this.isPrimary = false,
  });

  factory WarehouseModel.fromMap(String id, Map<String, dynamic> data) {
    return WarehouseModel(
      id: id,
      code: data['code'] ?? id,
      name: data['name'] ?? '',
      city: data['city'] ?? '',
      state: data['state'] ?? '',
      address: data['address'] ?? '',
      contactPerson: data['contactPerson'] ?? '',
      phone: data['phone'] ?? '',
      status: data['status'] ?? 'Active',
      isPrimary: data['isPrimary'] == true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'code': code,
      'name': name,
      'city': city,
      'state': state,
      'address': address,
      'contactPerson': contactPerson,
      'phone': phone,
      'status': status,
      'isPrimary': isPrimary,
    };
  }
}

class ProductModel {
  final String id;
  final String itemCode;
  final String name;
  final String barcode;
  final String category;
  final String brand;
  final String unit;
  final double purchaseRate;
  final double sellingRate;
  final int minStock;
  final int maxStock;

  ProductModel({
    required this.id,
    required this.itemCode,
    required this.name,
    this.barcode = '',
    this.category = '',
    this.brand = '',
    this.unit = 'Pcs',
    this.purchaseRate = 0.0,
    this.sellingRate = 0.0,
    this.minStock = 0,
    this.maxStock = 0,
  });

  factory ProductModel.fromMap(String id, Map<String, dynamic> data) {
    return ProductModel(
      id: id,
      itemCode: data['itemCode'] ?? id,
      name: data['name'] ?? '',
      barcode: data['barcode'] ?? '',
      category: data['category'] ?? '',
      brand: data['brand'] ?? '',
      unit: data['unit'] ?? 'Pcs',
      purchaseRate: (data['purchaseRate'] as num?)?.toDouble() ?? 0.0,
      sellingRate: (data['sellingRate'] as num?)?.toDouble() ?? 0.0,
      minStock: (data['minStock'] as num?)?.toInt() ?? 0,
      maxStock: (data['maxStock'] as num?)?.toInt() ?? 0,
    );
  }
}

class StockModel {
  final String id;
  final String warehouseId;
  final String warehouseName;
  final String itemCode;
  final String itemName;
  final String barcode;
  final int availableQty;
  final int reservedQty;
  final int inTransitQty;
  final int damagedQty;
  final int totalQty;

  StockModel({
    required this.id,
    required this.warehouseId,
    required this.warehouseName,
    required this.itemCode,
    required this.itemName,
    this.barcode = '',
    this.availableQty = 0,
    this.reservedQty = 0,
    this.inTransitQty = 0,
    this.damagedQty = 0,
    this.totalQty = 0,
  });

  factory StockModel.fromMap(String id, Map<String, dynamic> data) {
    return StockModel(
      id: id,
      warehouseId: data['warehouseId'] ?? '',
      warehouseName: data['warehouseName'] ?? '',
      itemCode: data['itemCode'] ?? '',
      itemName: data['itemName'] ?? '',
      barcode: data['barcode'] ?? '',
      availableQty: (data['availableQty'] as num?)?.toInt() ?? 0,
      reservedQty: (data['reservedQty'] as num?)?.toInt() ?? 0,
      inTransitQty: (data['inTransitQty'] as num?)?.toInt() ?? 0,
      damagedQty: (data['damagedQty'] as num?)?.toInt() ?? 0,
      totalQty: (data['totalQty'] as num?)?.toInt() ?? 0,
    );
  }
}

class TransferModel {
  final String id;
  final String transferNumber;
  final String sourceWarehouseId;
  final String sourceWarehouseName;
  final String destWarehouseId;
  final String destWarehouseName;
  final String itemCode;
  final String itemName;
  final int qty;
  final String status;
  final String createdAt;
  final String createdBy;
  final String remarks;

  TransferModel({
    required this.id,
    required this.transferNumber,
    required this.sourceWarehouseId,
    required this.sourceWarehouseName,
    required this.destWarehouseId,
    required this.destWarehouseName,
    required this.itemCode,
    required this.itemName,
    required this.qty,
    required this.status,
    required this.createdAt,
    this.createdBy = '',
    this.remarks = '',
  });

  factory TransferModel.fromMap(String id, Map<String, dynamic> data) {
    return TransferModel(
      id: id,
      transferNumber: data['transferNumber'] ?? '',
      sourceWarehouseId: data['sourceWarehouseId'] ?? '',
      sourceWarehouseName: data['sourceWarehouseName'] ?? '',
      destWarehouseId: data['destWarehouseId'] ?? '',
      destWarehouseName: data['destWarehouseName'] ?? '',
      itemCode: data['itemCode'] ?? '',
      itemName: data['itemName'] ?? '',
      qty: (data['qty'] as num?)?.toInt() ?? 0,
      status: data['status'] ?? 'Draft',
      createdAt: data['createdAt'] ?? '',
      createdBy: data['createdBy'] ?? '',
      remarks: data['remarks'] ?? '',
    );
  }
}

class UserProfile {
  final String uid;
  final String name;
  final String email;
  final String role; // 'Super Admin' | 'Store Operator' | 'Viewer'
  final String warehouseId;
  final String status; // 'Active' | 'Disabled'

  UserProfile({
    required this.uid,
    required this.name,
    required this.email,
    required this.role,
    required this.warehouseId,
    this.status = 'Active',
  });

  factory UserProfile.fromMap(String uid, Map<String, dynamic> data) {
    return UserProfile(
      uid: uid,
      name: data['name'] ?? '',
      email: data['email'] ?? '',
      role: data['role'] ?? 'Store Operator',
      warehouseId: data['warehouseId'] ?? 'WH-MUM',
      status: data['status'] ?? 'Active',
    );
  }
}
