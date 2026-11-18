import qrcode

# כתובת האתר שאליה יוביל הקוד
url = "https://ehudelfer.github.io/Rivka_Dikstein_Lab/"

# יצירת הקוד ושמירה כתמונה
qr_image = qrcode.make(url)
qr_image.save("lab_orders_qr.png")
print("QR code saved successfully as lab_orders_qr.png!")