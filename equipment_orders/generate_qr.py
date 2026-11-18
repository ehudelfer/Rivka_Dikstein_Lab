import qrcode

url = "https://ehudelfer.github.io/Rivka_Dikstein_Lab/"

for filename, target in (
    ("lab_orders_qr.png", url),
    ("delivery_receiving_qr.png", url + "?mode=delivery"),
):
    qrcode.make(target).save(filename)
    print(f"QR code saved successfully as {filename}!")