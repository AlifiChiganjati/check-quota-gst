# PROJECT CHECK GST QUOTA

## CLEAN ARCHITECTURE

jadi program di bagi jadi beberapa layer agar mudah saat di maintenance.

REPOSITORY > SERVICE > INTERFACE > index.js

## SUMMARY

- repository: query yang di akan di pakai
- config: ini config db
- service: bisnis logic program
- interfaces: ini handler dari program
- index.js: end point project

## POTENTIAL BUGS

1. ref++  
   jadi ref terus nambah padahal sekali saja di insert tapi masih bocor jadi insert ke ref++

2. trafic terlalu padat  
   karena terlalu banyak sekali konsol yg berjalan, akhir nya trafic core 4 terlalu padet.

3. kalau di website buffring saat klik success di log artinya pengecekan ga jalan.
