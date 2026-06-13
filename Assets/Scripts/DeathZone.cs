using UnityEngine;

public class DeathZone : MonoBehaviour
{
    void OnTriggerEnter2D(Collider2D col)
    {
        col.GetComponent<PlayerHealth>()?.TakeDamage();
    }
}
