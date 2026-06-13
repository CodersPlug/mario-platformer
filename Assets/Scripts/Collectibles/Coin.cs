using UnityEngine;

public class Coin : MonoBehaviour
{
    void OnTriggerEnter2D(Collider2D col)
    {
        if (!col.CompareTag("Player")) return;
        GameManager.Instance.AddCoin();
        Destroy(gameObject);
    }
}
